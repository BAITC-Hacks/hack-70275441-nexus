import { test } from "node:test";
import assert from "node:assert/strict";
import { runCrossSectionalAgents } from "../crossSectional/agents.ts";
import { analyzeCrossSectional } from "../crossSectional/tools.ts";
import { buildCrossSectionalEvidence } from "../crossSectional/evidence.ts";
import { runEventAgents } from "../eventTransaction/agents.ts";
import { analyzeEventTransactions } from "../eventTransaction/tools.ts";
import { buildEventTransactionEvidence } from "../eventTransaction/evidence.ts";
import { runEventTransactionInvestigation } from "../eventTransaction/workflow.ts";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import { runExportDecisionAction } from "../action/exportDecision.ts";
import { validateTargetedAssumption } from "./callToolAudit.ts";
import { containsEventMetric } from "../eventTransaction/agents.ts";
import type { BoundedRequestFn } from "./boundedRuntime/runtime.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

const csDataset: UploadedDataset = { name: "entities.csv", columns: ["client_id", "risk_score", "amount", "segment"], rows: Array.from({ length: 30 }, (_, i) => ({ client_id: `C${i}`, risk_score: i, amount: i * 2, segment: i % 2 ? "A" : "B" })) };
const etDataset: UploadedDataset = { name: "appeals.csv", columns: ["request_id", "submitted_at", "service_type", "department", "processing_days", "repeat_request"], rows: Array.from({ length: 30 }, (_, i) => ({ request_id: `R${i}`, submitted_at: new Date(Date.UTC(2026, 7, 1) + i * 60000).toISOString(), service_type: "Service", department: "Department", processing_days: i < 10 ? 20 : 2, repeat_request: false })) };
const cs = analyzeCrossSectional(csDataset, "risk_score"), ce = buildCrossSectionalEvidence(cs);
const et = analyzeEventTransactions(etDataset), ee = buildEventTransactionEvidence(et);
/**
 * The ET case previously exercised the government-only bounded tool pack (removed along with the
 * Government Services vertical). EventTransaction's own remaining
 * tools (summarize_*, inspect_*) take an id-based argument, not this table's "none"-argument shape, so
 * cross-workflow protocol coverage now runs through CS alone; runEventAgents/et fixtures above stay
 * imported for eventTransaction.test.ts-style integration coverage elsewhere in this file.
 */
const cases = [
  { name: "CS", run: (request: BoundedRequestFn) => runCrossSectionalAgents(cs, ce, undefined, undefined, { request }), investigatorTools: ["summarize_numeric_columns", "summarize_categorical_columns", "calculate_cross_sectional_associations"], skepticTools: ["inspect_target_provenance", "compare_delinquency_segment"] },
];
for (const scenario of cases) {
  for (const investigatorCalls of [1, 2, 3]) test(`${scenario.name}: Investigator executes ${investigatorCalls} checks and Skeptic executes two targeted checks`, async () => {
    const turns = { INVESTIGATOR: 0, SKEPTIC: 0 };
    const result = await scenario.run(async ({ role, payload, schema }) => {
      const turn = turns[role]++;
      const context = payload as { evidence: Array<{ id: string }>; allowedEvidenceIds: string[]; instruction: string };
      const properties = schema.properties as Record<string, { items?: { enum: string[] }; enum?: string[] }>;
      assert.deepEqual(properties.evidenceRefs.items!.enum, context.allowedEvidenceIds);
      assert.deepEqual(context.allowedEvidenceIds, context.evidence.map(item => item.id));
      assert.equal(context.evidence.length, (scenario.name === "CS" ? ce.length : ee.length) + (role === "INVESTIGATOR" ? turn : investigatorCalls + turn));
      const history = payload as { toolsAlreadyCalledByThisAgent: Array<{ tool: string; id: string | null; evidenceId: string }>; evidenceGeneratedByThisAgent: Array<{ id: string }>; remainingToolCallBudget: number; toolDecisionContract: string };
      assert.equal(history.toolsAlreadyCalledByThisAgent.length, turn);
      assert.equal(history.remainingToolCallBudget, (role === "INVESTIGATOR" ? 3 : 2) - turn);
      assert.deepEqual(history.evidenceGeneratedByThisAgent.map(item => item.id), history.toolsAlreadyCalledByThisAgent.map(item => item.evidenceId));
      assert.ok(history.toolDecisionContract.includes("Do NOT repeat an identical tool + argument"));
      assert.ok(history.toolDecisionContract.includes("Never call another tool merely to consume"));
      if (turn) assert.equal(history.toolsAlreadyCalledByThisAgent[0].tool, (role === "INVESTIGATOR" ? scenario.investigatorTools : scenario.skepticTools)[0]);
      if (role === "INVESTIGATOR" && turn === 3 || role === "SKEPTIC" && turn === 2) assert.deepEqual(properties.action.enum, [role === "INVESTIGATOR" ? "FORM_HYPOTHESIS" : "FINAL_VERDICT"]);
      const limit = role === "INVESTIGATOR" ? investigatorCalls : 2;
      const call = turn < limit;
      const selectedTool = (role === "INVESTIGATOR" ? scenario.investigatorTools : scenario.skepticTools)[Math.min(turn, limit - 1)];
      const common = { action: call ? "CALL_TOOL" : role === "INVESTIGATOR" ? "FORM_HYPOTHESIS" : "FINAL_VERDICT", tool: call ? selectedTool : "NONE", id: "NONE", selectedTool, alternativeExplanation: "Case mix remains plausible.", evidenceRefs: call ? [] : [context.allowedEvidenceIds.at(-1)] };
      return JSON.stringify(role === "INVESTIGATOR" ? { ...common, hypothesis: "Observed patterns warrant review.", rationale: "Published Evidence supports review." } : { ...common, targetedAssumption: call ? "The observed pattern survives a source-quality check." : "", status: "CHALLENGED", challenge: "Unknown context limits interpretation." });
    });
    assert.deepEqual(result.agentCalls.map(call => [call.outcome, call.toolCalls]), [["LIVE_AGENT", investigatorCalls], ["LIVE_AGENT", 2]]);
    assert.equal(result.onDemandEvidence!.length, investigatorCalls + 2);
    assert.ok(result.toolTrace!.filter(call => call.role === "SKEPTIC").every(call => call.metadata!.targetedAssumption === "The observed pattern survives a source-quality check."));
    assert.equal(result.llmCalls, investigatorCalls + 4);
  });

  test(`${scenario.name}: future Evidence and duplicate calls remain rejected`, async () => {
    const invalid = await scenario.run(async () => JSON.stringify({ selectedTool: scenario.investigatorTools[0], hypothesis: "Review is warranted.", alternativeExplanation: "Case mix.", rationale: "Evidence only.", evidenceRefs: ["E-999"] }));
    assert.equal(invalid.agentCalls[0].fallbackReason, "INVALID_EVIDENCE_REFERENCE");
    const duplicate = await scenario.run(async () => JSON.stringify({ action: "CALL_TOOL", tool: scenario.investigatorTools[0], id: "NONE" }));
    assert.equal(duplicate.agentCalls[0].fallbackReason, "DUPLICATE_TOOL_CALL");
    assert.equal(duplicate.agentCalls[0].toolCalls, 1);
    const future = scenario.name === "CS" ? `E-${String(ce.length + 1).padStart(3, "0")}` : `E-${String(ee.length + 1).padStart(3, "0")}`;
    const futureResult = await scenario.run(async () => JSON.stringify({ selectedTool: scenario.investigatorTools[0], hypothesis: "Review is warranted.", alternativeExplanation: "Case mix.", rationale: "Evidence only.", evidenceRefs: [future] }));
    assert.equal(futureResult.agentCalls[0].fallbackReason, "INVALID_EVIDENCE_REFERENCE");
  });

  for (const roleToExhaust of ["INVESTIGATOR", "SKEPTIC"] as const) test(`${scenario.name}: ${roleToExhaust} cannot exceed its call limit`, async () => {
    let calls = 0;
    const result = await scenario.run(async ({ role, payload }) => {
      const context = payload as { allowedEvidenceIds: string[] };
      const selectedTool = (role === "INVESTIGATOR" ? scenario.investigatorTools : scenario.skepticTools)[calls % (role === "INVESTIGATOR" ? 3 : 2)];
      if (roleToExhaust === "SKEPTIC" && role === "INVESTIGATOR") return JSON.stringify({ selectedTool, hypothesis: "Review is warranted.", alternativeExplanation: "Case mix.", rationale: "Evidence only.", evidenceRefs: [context.allowedEvidenceIds[0]] });
      calls++;
      return JSON.stringify({ action: "CALL_TOOL", tool: selectedTool, id: "NONE", selectedTool, hypothesis: "Review is warranted.", rationale: "Evidence only.", targetedAssumption: "Source quality is sufficient.", status: "CHALLENGED", challenge: "Context may differ.", alternativeExplanation: "Case mix.", evidenceRefs: [context.allowedEvidenceIds[0]] });
    });
    const call = result.agentCalls.find(call => call.agentRole === roleToExhaust)!;
    assert.equal(call.toolCalls, roleToExhaust === "INVESTIGATOR" ? 3 : 2);
    assert.equal(call.fallbackReason, "TERMINAL_TURN_REQUIRED");
  });
}

test("validated Skeptic assumptions survive both workflows into public Technical Trace", async () => {
  for (const scenario of cases) {
    const turns = { INVESTIGATOR: 0, SKEPTIC: 0 };
    const request: BoundedRequestFn = async ({ role, payload }) => {
      const turn = turns[role]++;
      const context = payload as { allowedEvidenceIds: string[] };
      const tool = role === "INVESTIGATOR" ? scenario.investigatorTools[0] : scenario.skepticTools[0];
      const common = { action: turn ? role === "INVESTIGATOR" ? "FORM_HYPOTHESIS" : "FINAL_VERDICT" : "CALL_TOOL", tool: turn ? "NONE" : tool, id: "NONE", selectedTool: tool, evidenceRefs: turn ? [context.allowedEvidenceIds.at(-1)] : [], alternativeExplanation: "Case mix remains plausible." };
      return JSON.stringify(role === "INVESTIGATOR" ? { ...common, hypothesis: "Published patterns warrant review.", rationale: "Evidence supports review." } : { ...common, targetedAssumption: "The pattern survives a source-quality check.", status: "CHALLENGED", challenge: "Unknown context limits interpretation." });
    };
    const result = scenario.name === "CS"
      ? await runCrossSectionalInvestigation({ dataset: csDataset, signals: [], target: "risk_score" }, (analysis, evidence, metadata, objective) => runCrossSectionalAgents(analysis, evidence, metadata, objective, { request }))
      : await runEventTransactionInvestigation({ dataset: etDataset, signals: [] }, (analysis, evidence, objective, options) => runEventAgents(analysis, evidence, objective, { ...options, request }));
    assert.equal(result.validation.status, "VALIDATED");
    const audit = result.artifact.trace.find(entry => entry.metadata?.targetedAssumption);
    assert.equal(audit!.agent, "SKEPTIC");
    assert.ok(audit!.summary.includes("The pattern survives a source-quality check."));
    assert.equal(runExportDecisionAction(result, { executionLedger: new Set() }).status, "VERIFIED");
  }
});

test("targeted assumptions must be concise, nonempty and free of authoritative numeric claims", () => {
  for (const targetedAssumption of [undefined, " ", "x".repeat(241), "There are 99 affected requests."]) assert.equal(validateTargetedAssumption({ targetedAssumption }, containsEventMetric).ok, false);
  assert.deepEqual(validateTargetedAssumption({ targetedAssumption: " Source reliability. " }, containsEventMetric), { ok: true, metadata: { targetedAssumption: "Source reliability." } });
});
