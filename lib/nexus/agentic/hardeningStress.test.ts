import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { syntheticIndustrialDataset } from "../demo/syntheticIndustrial.ts";
import { createTimeSeriesArtifact, validateTimeSeriesArtifact } from "../timeSeries/validator.ts";
import { runExportDecisionAction } from "../action/exportDecision.ts";

const root = new URL("../../../", import.meta.url);
const hookForServerModules = () => registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export%20default%20%7B%7D", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const url = new URL(specifier.slice(2) + (specifier.endsWith(".json") ? "" : ".ts"), root);
    if (specifier.endsWith(".json")) return { url: `data:text/javascript,export default ${encodeURIComponent(readFileSync(url, "utf8"))}`, shortCircuit: true };
    return { url: url.href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(specifier + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
function modelResponse(value: unknown) {
  return new Response(JSON.stringify({ id: "resp_mock", object: "response", status: "completed", output: [{ type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] }] }), { headers: { "content-type": "application/json" } });
}

test("20 complete generic time-series investigations survive scripted transient, timeout and invalid-output failures", async t => {
  const hook = hookForServerModules();
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY, previousUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "mock-secret-not-for-display";
  process.env.OPENAI_BASE_URL = "https://runtime-hardening.invalid/v1";
  const dataset = syntheticIndustrialDataset();
  const signals = dataset.columns.filter(c => c !== "timestamp" && c !== "machine_id" && c !== "failure_flag" && c !== "vibration_rms").slice(0, 6);
  const input = { dataset, signals, taskId: "generic", intent: "INVESTIGATE" as const, mapping: { date: "timestamp", target: "vibration_rms" } };
  let completed = 0, fallbacks = 0, retries = 0, pipelineComplete = 0, baselineFiles = "";
  try {
    const { runAgenticInvestigation } = await import("./orchestrator.ts");
    for (let run = 0; run < 20; run++) {
      const attempts = { INVESTIGATOR: 0, SKEPTIC: 0 }, successes = { INVESTIGATOR: 0, SKEPTIC: 0 };
      globalThis.fetch = async (resource, options) => {
        const request = new Request(resource, options);
        assert.ok(request.url.startsWith("https://runtime-hardening.invalid/"), "Never call a live API in stress tests");
        const body = JSON.parse(await request.text());
        const investigator = body.text.format.name === "investigator_action";
        const role = investigator ? "INVESTIGATOR" : "SKEPTIC";
        attempts[role]++;
        if ((run === 17 && investigator || run === 18) && attempts[role] <= 2) throw Object.assign(new Error("mock-secret raw timeout"), { name: "AbortError" });
        if (investigator && attempts[role] === 1 && run >= 5 && run <= 16) {
          if (run <= 7) throw Object.assign(new Error("mock-secret timeout"), { name: "AbortError" });
          if (run <= 10) return new Response('{"error":{"message":"mock-secret rate limit"}}', { status: 429, headers: { "content-type": "application/json" } });
          if (run <= 13) return new Response('{"error":{"message":"mock-secret server failure"}}', { status: 500, headers: { "content-type": "application/json" } });
          throw new TypeError("mock-secret network error");
        }
        if (run === 19 && investigator) return modelResponse(null);
        const context = JSON.parse(body.input[1].content);
        const first = successes[role]++ === 0;
        const tool = investigator ? "detect_outliers" : "inspect_missingness";
        const common = { action: first ? "CALL_TOOL" : investigator ? "FORM_HYPOTHESIS" : "FINAL_VERDICT", tool: first ? tool : "NONE", arguments: { column: signals[0], left: "NONE", right: "NONE" }, reason_summary: "Inspect the supplied observations.", supporting_evidence: context.evidence.map((e: { id: string }) => e.id) };
        return modelResponse(investigator ? { ...common, primary_hypothesis: "Supply observations warrant review without establishing cause.", alternative_explanation: "Other factors remain plausible.", limitations: ["Correlation is not causal proof."] } : { ...common, status: "INCONCLUSIVE", challenge_summary: "Alternative factors cannot establish cause.", weaknesses: ["Missing contextual information."] });
      };
      const output = await runAgenticInvestigation(dataset, signals, undefined, "vibration_rms", "generic", "Inspect equipment drift", "timestamp");
      for (const agent of [output.agentic.investigator, output.agentic.skeptic]) {
        const audit = agent.runtime!;
        assert.equal(audit.status, agent.source === "LLM" ? "COMPLETED" : "FALLBACK");
        assert.ok(audit.steps.every(step => step.attempts <= 2));
        if (agent.source === "LLM") completed++; else fallbacks++;
        retries += audit.steps.reduce((sum, step) => sum + step.attempts - 1, 0);
        assert.doesNotMatch(JSON.stringify(audit), /mock-secret|raw timeout|authorization/);
      }
      if (run === 17 || run === 18) assert.equal(output.agentic.investigator.runtime!.errorCategory, "TIMEOUT");
      if (run === 18) assert.equal(output.agentic.skeptic.runtime!.errorCategory, "TIMEOUT");
      if (run === 19) assert.equal(output.agentic.investigator.runtime!.errorCategory, "INVALID_STRUCTURED_OUTPUT");
      assert.ok(output.agentic.evidence.length > 0);
      const artifact = createTimeSeriesArtifact(input, { analysis: output.analysis, precursorChain: output.agentic.precursorChain });
      const validation = validateTimeSeriesArtifact(input, artifact);
      assert.equal(validation.status, "VALIDATED");
      const action = runExportDecisionAction({ kind: "TIME_SERIES", artifact, validation }, { executionLedger: new Set() });
      assert.equal(action.status, "VERIFIED");
      const files = JSON.stringify(action.execution!.files.map(file => {
        if (file.fileName !== "validated_decision.json") return file;
        const decision = JSON.parse(file.content);
        // Real export timestamps differ across runs; all decision-bound fields must remain equal.
        delete decision.generatedAt;
        return { ...file, content: JSON.stringify(decision) };
      }));
      if (!run) baselineFiles = files;
      assert.equal(files, baselineFiles, "Transport outcomes do not affect deterministic export");
      pipelineComplete++;
    }
    assert.deepEqual({ pipelineComplete, completed, retries, fallbacks, failures: 20 - pipelineComplete }, { pipelineComplete: 20, completed: 36, retries: 15, fallbacks: 4, failures: 0 });
    t.diagnostic(JSON.stringify({ pipelineComplete, aiCompleted: completed, retries, fallbacks, pipelineFailures: 20 - pipelineComplete }));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previousUrl;
    hook.deregister();
  }
});
