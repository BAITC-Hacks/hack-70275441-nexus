import { test } from "node:test";
import assert from "node:assert/strict";
import { bankClients, bankFixtureMetadata } from "../universal/fixtures.ts";
import { runCrossSectionalAgents } from "./agents.ts";
import { buildCrossSectionalEvidence } from "./evidence.ts";
import { analyzeCrossSectional } from "./tools.ts";
import { runCrossSectionalInvestigation } from "./workflow.ts";

const analysis = analyzeCrossSectional(bankClients, "risk_score", bankFixtureMetadata);
const evidence = buildCrossSectionalEvidence(analysis, bankFixtureMetadata);
const investigator = JSON.stringify({ selectedTool: "calculate_cross_sectional_associations", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Confounding or target construction may explain the pattern.", rationale: "The interpretation is restricted to the cited deterministic evidence.", evidenceRefs: ["E-004"] });
const skeptic = JSON.stringify({ selectedTool: "inspect_target_provenance", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "The supplied target may reuse predictors, creating leakage or circularity without proving causality.", alternativeExplanation: "Confounding and selection effects remain plausible.", evidenceRefs: ["E-004", "E-007"] });
const successfulRequest = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => role === "INVESTIGATOR" ? investigator : skeptic;

test("successful responses record two bounded LIVE_AGENT calls", async () => {
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request: successfulRequest, model: "test-model" });
  assert.equal(result.investigator.source, "LLM");
  assert.equal(result.skeptic.source, "LLM");
  assert.equal(result.llmCalls, 2);
  assert.deepEqual(result.agentCalls.map((call) => call.outcome), ["LIVE_AGENT", "LIVE_AGENT"]);
  assert.ok(result.agentCalls.every((call) => call.model === "test-model" && call.toolCalls === 0 && call.retryCount === 0 && call.fallbackReason === null));
});

test("timeout records the exact reason and preserves fallback", async () => {
  const request = ({ signal }: { signal: AbortSignal }) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request, timeoutMs: 5 });
  assert.equal(result.investigator.source, "FALLBACK");
  assert.equal(result.skeptic.source, "FALLBACK");
  assert.equal(result.llmCalls, 1);
  assert.equal(result.agentCalls[0].outcome, "TIMEOUT");
  assert.equal(result.agentCalls[0].fallbackReason, "TIMEOUT");
  assert.equal(result.agentCalls[1].fallbackReason, "INVESTIGATOR_FAILED");
});

test("unknown API error exposes only safe diagnostics before fallback", async () => {
  const request = async () => { const error = new Error("service unavailable") as Error & { code: string }; error.code = "upstream_unavailable"; throw error; };
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.agentCalls[0].outcome, "API_ERROR");
  assert.equal(result.agentCalls[0].errorClass, "RuntimeError");
  assert.equal(result.agentCalls[0].errorCode, null);
  assert.equal(result.agentCalls[0].fallbackReason, "UNKNOWN_ERROR");
  assert.equal(result.agentCalls[0].runtime!.errorCategory, "UNKNOWN_ERROR");
});

test("JSON and semantic schema failures are distinguished", async () => {
  const invalidJson = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request: async () => "not-json" });
  assert.equal(invalidJson.agentCalls[0].outcome, "SCHEMA_ERROR");
  assert.equal(invalidJson.agentCalls[0].fallbackReason, "JSON_PARSE_FAILURE");
  const invalidShape = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request: async () => JSON.stringify({ selectedTool: "unknown" }) });
  assert.equal(invalidShape.agentCalls[0].outcome, "SCHEMA_ERROR");
  assert.equal(invalidShape.agentCalls[0].fallbackReason, "SCHEMA_VALIDATION_FAILURE");
});

test("authoritative agent metrics are rejected without changing deterministic analysis", async () => {
  const attemptedMetric = JSON.stringify({ selectedTool: "calculate_cross_sectional_associations", hypothesis: "Risk is 99 percent.", alternativeExplanation: "Confounding remains plausible.", rationale: "Evidence supports review.", evidenceRefs: ["E-004"] });
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request: async () => attemptedMetric });
  assert.equal(result.investigator.source, "FALLBACK");
  assert.equal(result.agentCalls[0].fallbackReason, "AUTHORITATIVE_METRIC_REJECTED");
  assert.deepEqual(analysis, analyzeCrossSectional(bankClients, "risk_score", bankFixtureMetadata));
});

test("a Skeptic failure keeps a successful Investigator and exact fallback reason", async () => {
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "INVESTIGATOR") return investigator;
    const error = new Error("bad gateway") as Error & { status: number }; error.status = 502; throw error;
  };
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.investigator.source, "LLM");
  assert.equal(result.skeptic.source, "FALLBACK");
  assert.deepEqual(result.agentCalls.map((call) => call.outcome), ["LIVE_AGENT", "API_ERROR"]);
  assert.equal(result.agentCalls[1].errorCode, "502");
});

test("Investigator genuinely executes a live tool (CALL_TOOL) and cites the resulting on-demand Evidence, continuing the id sequence after baseline", async () => {
  let investigatorCalls = 0;
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "SKEPTIC") return skeptic;
    investigatorCalls += 1;
    if (investigatorCalls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "summarize_numeric_columns", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
    return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "Numeric distributions support the association.", alternativeExplanation: "Confounding remains plausible.", rationale: "Grounded in the freshly revealed numeric summary.", evidenceRefs: ["E-008"] });
  };
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.investigator.source, "LLM");
  assert.equal(result.onDemandEvidence?.length, 1);
  assert.equal(result.onDemandEvidence?.[0].id, "E-008");
  assert.equal(result.onDemandEvidence?.[0].tool, "summarize_numeric_columns");
  assert.equal(result.onDemandEvidence?.[0].usedBy[0], "INVESTIGATOR");
  assert.deepEqual(result.investigator.evidenceRefs, ["E-008"]);
  assert.equal(result.toolTrace?.length, 1);
  assert.equal(result.toolTrace?.[0].role, "INVESTIGATOR");
  assert.equal(result.toolTrace?.[0].tool, "summarize_numeric_columns");
});

test("Skeptic genuinely executes a live tool (inspect_target_provenance) after the Investigator's own on-demand evidence, continuing the id sequence further", async () => {
  let investigatorCalls = 0;
  let skepticCalls = 0;
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "INVESTIGATOR") {
      investigatorCalls += 1;
      if (investigatorCalls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "calculate_cross_sectional_associations", id: "NONE", selectedTool: "calculate_cross_sectional_associations", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
      return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "calculate_cross_sectional_associations", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Confounding may explain the pattern.", rationale: "Grounded in the freshly revealed associations.", evidenceRefs: ["E-008"] });
    }
    skepticCalls += 1;
    if (skepticCalls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "inspect_target_provenance", id: "NONE", selectedTool: "inspect_target_provenance", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "interim", alternativeExplanation: "interim", evidenceRefs: [] });
    return JSON.stringify({ action: "FINAL_VERDICT", tool: "NONE", id: "NONE", selectedTool: "inspect_target_provenance", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "Prepared provenance shows the supplied score reuses inspected predictors, so the association may be circular.", alternativeExplanation: "Confounding and selection effects remain plausible.", evidenceRefs: ["E-009"] });
  };
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.investigator.source, "LLM");
  assert.equal(result.skeptic.source, "LLM");
  assert.equal(result.onDemandEvidence?.length, 2);
  assert.deepEqual(result.onDemandEvidence?.map((item) => item.id), ["E-008", "E-009"]);
  assert.equal(result.onDemandEvidence?.[1].tool, "inspect_target_provenance");
  assert.equal(result.onDemandEvidence?.[1].usedBy[0], "SKEPTIC");
  assert.deepEqual(result.skeptic.evidenceRefs, ["E-009"]);
  assert.equal(result.toolTrace?.length, 2);
});

test("live tool-calling still rejects a numeric-authority leak in the terminal narrative, exactly as before", async () => {
  let calls = 0;
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "SKEPTIC") return skeptic;
    calls += 1;
    if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "summarize_numeric_columns", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
    return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "Risk is 99 percent.", alternativeExplanation: "Confounding remains plausible.", rationale: "Evidence supports review.", evidenceRefs: ["E-008"] });
  };
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.investigator.source, "FALLBACK");
  assert.equal(result.agentCalls[0].fallbackReason, "AUTHORITATIVE_METRIC_REJECTED");
});

test("live and fallback paths preserve the same deterministic artifact and expose the reason in Technical Trace", async () => {
  const live = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, (nextAnalysis, nextEvidence, metadata, objective) => runCrossSectionalAgents(nextAnalysis, nextEvidence, metadata, objective, { request: successfulRequest }));
  const unavailable = async () => { throw new Error("network unavailable"); };
  const fallback = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, (nextAnalysis, nextEvidence, metadata, objective) => runCrossSectionalAgents(nextAnalysis, nextEvidence, metadata, objective, { request: unavailable }));
  assert.deepEqual(live.artifact.analysis, fallback.artifact.analysis);
  assert.deepEqual(live.artifact.evidence, fallback.artifact.evidence);
  assert.equal(live.validation.status, "VALIDATED");
  assert.equal(fallback.validation.status, "VALIDATED");
  assert.equal(fallback.artifact.technicalTrace.agentCalls[0].fallbackReason, "UNKNOWN_ERROR");
});

test("a Russian-language provenance challenge is accepted, not rejected as PROVENANCE_CHALLENGE_MISSING", async () => {
  const russianSkeptic = JSON.stringify({ selectedTool: "inspect_target_provenance", targetedAssumption: "Наблюдаемые связи остаются значимыми после проверки происхождения данных.", status: "CHALLENGED", challenge: "Заданный показатель может повторно использовать исследованные признаки, что создаёт утечку и циркулярность без доказательства причинности.", alternativeExplanation: "Смешивающие факторы и эффекты отбора остаются вероятными.", evidenceRefs: ["E-004", "E-007"] });
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => role === "INVESTIGATOR" ? investigator : russianSkeptic;
  const result = await runCrossSectionalAgents(analysis, evidence, bankFixtureMetadata, undefined, { request });
  assert.equal(result.skeptic.source, "LLM");
  assert.equal(result.agentCalls[1].outcome, "LIVE_AGENT");
});
