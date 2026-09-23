import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EvidenceRecord } from "./types.ts";
import type { NexusToolDefinition } from "./toolPack.ts";

function mockResponse(action: object) {
  return new Response(JSON.stringify({ id: "resp_mock", object: "response", status: "completed", output: [{ type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(action), annotations: [] }] }] }), { headers: { "content-type": "application/json" } });
}

test("TIME_SERIES agents reject unknown or mixed Evidence refs, preserving valid refs and empty-ref rules", async () => {
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "mock-key";
  const dataset = { name: "scripted", columns: ["x"], rows: [{ x: 1 }, { x: 2 }, { x: 3 }] };
  const baseline: EvidenceRecord = { id: "E-001", tool: "profile_dataset", variables: ["x"], result: "Observed rows", data: { rowCount: 3 }, usedBy: ["OBSERVER"] };
  const pack: NexusToolDefinition[] = [{ name: "inspect_scripted", description: "Inspect observations", argumentKind: "none", allowedAgents: ["INVESTIGATOR", "SKEPTIC"], execute: () => ({ summary: "Observed rows", data: { rowCount: dataset.rows.length }, variables: ["x"] }) }];
  try {
    const { runLiveInvestigator } = await import("./liveInvestigator.ts");
    const { runLiveSkeptic } = await import("./liveSkeptic.ts");
    for (const role of ["INVESTIGATOR", "SKEPTIC"] as const) for (const refs of [["E-999"], ["E-002", "E-999"], ["E-001", "E-002"], []]) {
      let requests = 0, calls = 0;
      const payloads: Array<{ input: Array<{ content: string }>; text: { format: { schema: { properties: { supporting_evidence: { items: { enum?: string[] }; maxItems?: number } } } } } }> = [];
      globalThis.fetch = async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        const first = requests++ === 0;
        const common = { action: first ? "CALL_TOOL" : role === "INVESTIGATOR" ? "FORM_HYPOTHESIS" : "FINAL_VERDICT", tool: first ? "inspect_scripted" : "NONE", arguments: { column: "NONE", left: "NONE", right: "NONE" }, reason_summary: "Inspect observations", supporting_evidence: first ? ["E-001"] : refs };
        const action = role === "INVESTIGATOR" ? { ...common, primary_hypothesis: "Observations require review", alternative_explanation: "Other factors remain", limitations: ["No causal conclusion"] } : { ...common, status: "INCONCLUSIVE", challenge_summary: "Other factors remain", weaknesses: ["No causal conclusion"] };
        return mockResponse(action);
      };
      const execute = () => { calls++; const output = pack[0].execute({ dataset, signals: ["x"] }, {}); return { id: "E-002", tool: pack[0].name, variables: output.variables, result: output.summary, data: output.data, usedBy: [role] }; };
      const context = { dataset, signals: ["x"] }, evidence = [baseline];
      const result = role === "INVESTIGATOR" ? await runLiveInvestigator({ context, evidence, pack, remainingLlmCalls: 3, observerFindings: [], execute }) : await runLiveSkeptic({ context, evidence, pack, remainingLlmCalls: 3, hypothesis: "Review observations", alternative: "Other factors remain", observerFindings: [], execute });
      const invalid = refs.includes("E-999");
      assert.deepEqual(payloads[0].text.format.schema.properties.supporting_evidence.items.enum, ["E-001"]);
      assert.deepEqual(JSON.parse(payloads[0].input[1].content).currentEvidenceIds, ["E-001"]);
      assert.deepEqual(payloads[1].text.format.schema.properties.supporting_evidence.items.enum, ["E-001", "E-002"]);
      assert.deepEqual(JSON.parse(payloads[1].input[1].content).currentEvidenceIds, ["E-001", "E-002"]);
      assert.equal(result.source, invalid || role === "SKEPTIC" && !refs.length ? "FALLBACK" : "LLM");
      if (invalid) { assert.equal(result.runtime?.fallbackReason, "INVALID_EVIDENCE_REFERENCE"); assert.equal(result.runtime?.status, "FALLBACK"); assert.equal(requests, 2); }
      assert.equal(calls, 1);
      assert.deepEqual(dataset.rows, [{ x: 1 }, { x: 2 }, { x: 3 }]);
      if (result.source === "LLM") assert.equal(result.runtime?.status, "COMPLETED");
    }
    for (const role of ["INVESTIGATOR", "SKEPTIC"] as const) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.deepEqual(payload.text.format.schema.properties.supporting_evidence.items.enum, ["E-001"]);
        assert.deepEqual(JSON.parse(payload.input[1].content).currentEvidenceIds, ["E-001"]);
        const common = { action: "CALL_TOOL", tool: "inspect_scripted", arguments: { column: "NONE", left: "NONE", right: "NONE" }, reason_summary: "Inspect observations", supporting_evidence: ["E-002"] };
        return mockResponse(role === "INVESTIGATOR" ? { ...common, primary_hypothesis: "Review", alternative_explanation: "Other factors", limitations: [] } : { ...common, status: "INCONCLUSIVE", challenge_summary: "Review", weaknesses: [] });
      };
      const context = { dataset, signals: ["x"] }, evidence = [baseline];
      const execute = () => { calls++; return { ...baseline, id: "E-002" }; };
      const result = role === "INVESTIGATOR" ? await runLiveInvestigator({ context, evidence, pack, remainingLlmCalls: 3, observerFindings: [], execute }) : await runLiveSkeptic({ context, evidence, pack, remainingLlmCalls: 3, hypothesis: "Review", alternative: "Other factors", observerFindings: [], execute });
      assert.equal(result.source, "FALLBACK");
      assert.equal(result.runtime?.fallbackReason, "INVALID_EVIDENCE_REFERENCE");
      assert.equal(calls, 0, `${role} must reject future Evidence before tool execution`);
    }
    for (const role of ["INVESTIGATOR", "SKEPTIC"] as const) {
      let requests = 0, calls = 0;
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        const first = requests++ === 0;
        const refs = payload.text.format.schema.properties.supporting_evidence;
        if (first) {
          assert.equal(refs.maxItems, 0);
          assert.deepEqual(JSON.parse(payload.input[1].content).currentEvidenceIds, []);
        } else {
          assert.deepEqual(refs.items.enum, ["E-001"]);
          assert.deepEqual(JSON.parse(payload.input[1].content).currentEvidenceIds, ["E-001"]);
        }
        const common = { action: first ? "CALL_TOOL" : role === "INVESTIGATOR" ? "FORM_HYPOTHESIS" : "FINAL_VERDICT", tool: first ? "inspect_scripted" : "NONE", arguments: { column: "NONE", left: "NONE", right: "NONE" }, reason_summary: "Review", supporting_evidence: first ? [] : ["E-001"] };
        return mockResponse(role === "INVESTIGATOR" ? { ...common, primary_hypothesis: "Review", alternative_explanation: "Other factors", limitations: [] } : { ...common, status: "INCONCLUSIVE", challenge_summary: "Review", weaknesses: [] });
      };
      const context = { dataset, signals: ["x"] }, execute = () => { calls++; return { ...baseline }; };
      const result = role === "INVESTIGATOR" ? await runLiveInvestigator({ context, evidence: [], pack, remainingLlmCalls: 3, observerFindings: [], execute }) : await runLiveSkeptic({ context, evidence: [], pack, remainingLlmCalls: 3, hypothesis: "Review", alternative: "Other factors", observerFindings: [], execute });
      assert.equal(result.source, "LLM");
      assert.equal(requests, 2);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; hook.deregister(); }
});
