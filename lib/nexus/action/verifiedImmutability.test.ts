import { test } from "node:test";
import assert from "node:assert/strict";
import { bankClients, eventActivityFixture } from "../universal/fixtures.ts";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import { runEventTransactionInvestigation } from "../eventTransaction/workflow.ts";
import type { CrossSectionalAgentRuns } from "../crossSectional/agents.ts";
import type { EventAgentRuns } from "../eventTransaction/agents.ts";
import { syntheticConstructionDataset } from "../construction/dataset.ts";
import { analyzeGeneric } from "../adapters/generic/analyze.ts";
import { buildPrecursorChain } from "../agentic/precursorChain.ts";
import { createTimeSeriesArtifact, validateTimeSeriesArtifact } from "../timeSeries/validator.ts";
import { getExportDecisionAction, runExportDecisionAction, verifyExecution } from "./exportDecision.ts";
import type { ActionRecord } from "./types.ts";
import type { EligibleWorkflowResult } from "./proposeAction.ts";

const fallback = async (): Promise<CrossSectionalAgentRuns & EventAgentRuns> => ({ llmCalls: 0, agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "Descriptive patterns warrant inspection.", alternativeExplanation: "Collection practices remain plausible.", rationale: "Only deterministic Evidence supports inspection.", evidenceRefs: ["E-001"] },
  skeptic: { source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Confounding remains plausible.", alternativeExplanation: "Patterns need review.", evidenceRefs: ["E-001"] },
});
const factories: Record<string, () => Promise<EligibleWorkflowResult> | EligibleWorkflowResult> = {
  TIME_SERIES: () => {
    const dataset = syntheticConstructionDataset(); const original = { dataset, signals: dataset.columns.filter(column => column !== "date"), taskId: "construction", mapping: { target: "schedule_gap_pp" } };
    const analysis = analyzeGeneric(dataset, original.signals);
    const artifact = createTimeSeriesArtifact(original, { analysis, precursorChain: buildPrecursorChain(dataset, analysis, original.mapping.target) });
    return { kind: "TIME_SERIES", artifact, validation: validateTimeSeriesArtifact(original, artifact) };
  },
  CROSS_SECTIONAL: () => runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, fallback),
  EVENT_TRANSACTION: () => runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallback),
  GOVERNMENT: () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ request_id: `R-${i}`, submitted_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), appeal_type: "initial", service_type: i < 20 ? "Delayed" : "Normal", department: "Department", processing_days: i < 20 ? 30 : 2, repeat_request: i < 20 }));
    return runEventTransactionInvestigation({ dataset: { name: "government-immutability.csv", columns: Object.keys(rows[0]), rows }, signals: [] }, fallback);
  },
};
for (const [name, factory] of Object.entries(factories)) {
  test(`${name}: VERIFIED snapshot prevents CSV, JSON and approved-proposal mutation`, async () => {
    const result = await factory(); const before = JSON.stringify(result.artifact);
    const cache = new Map<string, ActionRecord>(); const options = { actionCache: cache, executionLedger: new Set<string>() };
    const action = getExportDecisionAction(result, options); assert.equal(action.status, "VERIFIED");
    for (const file of action.execution!.files) {
      const original = file.content;
      assert.throws(() => { file.content += "modified"; }, TypeError);
      assert.equal(file.content, original); assert.ok(Object.isFrozen(file));
    }
    assert.throws(() => { action.proposal.reason = "changed"; }, TypeError);
    assert.throws(() => { action.execution!.files.push(action.execution!.files[0]); }, TypeError);
    assert.throws(() => { action.execution = null; }, TypeError);
    assert.equal(getExportDecisionAction(result, options), action);
    assert.equal(verifyExecution(result, action.proposal, action.execution!.files).status, "VERIFIED");
    assert.equal(JSON.stringify(result.artifact), before);
  });
  test(`${name}: changed cached CSV or JSON is reverified and downgraded to FAILED`, async () => {
    const result = await factory(); const trusted = runExportDecisionAction(result, { executionLedger: new Set() });
    for (const fileIndex of [0, 1]) {
      const injected = structuredClone(trusted);
      if (fileIndex === 0) {
        const decision = JSON.parse(injected.execution!.files[0].content); decision.reason = "modified reason";
        injected.execution!.files[0].content = JSON.stringify(decision);
      } else injected.execution!.files[1].content += "modified";
      const key = `${result.artifact.workflowId}:${result.validation.validatedArtifactHash}:EXPORT_DECISION`;
      const cache = new Map([[key, injected]]);
      const returned = getExportDecisionAction(result, { actionCache: cache, executionLedger: new Set() });
      assert.equal(returned.status, "FAILED"); assert.equal(returned.verification?.status, "FAILED");
      assert.equal(cache.get(key), returned); assert.ok(Object.isFrozen(returned));
      assert.ok(returned.trace.at(-1)?.summary.startsWith("Cached action integrity check failed:"));
      assert.equal(getExportDecisionAction(result, { actionCache: cache }).status, "FAILED");
    }
  });
  test(`${name}: exported JSON reason must match exactly, including whitespace and causal changes`, async () => {
    const result = await factory(); const action = runExportDecisionAction(result, { executionLedger: new Set() });
    for (const reason of ["modified", `${action.proposal.reason} `, "This signal causes the outcome.", null, undefined]) {
      const files = structuredClone(action.execution!.files); const decision = JSON.parse(files[0].content);
      decision.reason = reason; files[0].content = JSON.stringify(decision);
      const verification = verifyExecution(result, action.proposal, files);
      assert.equal(verification.status, "FAILED");
      assert.equal(verification.checks.find(check => check.id === "JSON_REASON_MATCHES")?.passed, false);
    }
  });
  test(`${name}: mutable but unchanged cache entry is defensively detached and frozen`, async () => {
    const result = await factory(); const mutable = structuredClone(runExportDecisionAction(result, { executionLedger: new Set() }));
    const key = `${result.artifact.workflowId}:${result.validation.validatedArtifactHash}:EXPORT_DECISION`; const cache = new Map([[key, mutable]]);
    const snapshot = getExportDecisionAction(result, { actionCache: cache });
    assert.equal(snapshot.status, "VERIFIED"); assert.notEqual(snapshot, mutable);
    mutable.execution!.files[1].content += "modified";
    mutable.proposal.reason = "modified";
    assert.equal(verifyExecution(result, snapshot.proposal, snapshot.execution!.files).status, "VERIFIED");
    assert.equal(getExportDecisionAction(result, { actionCache: cache }), snapshot);
  });
}
test("malformed VERIFIED cache entry fails in a controlled way without export files", async () => {
  const result = await factories.CROSS_SECTIONAL(); const record = structuredClone(runExportDecisionAction(result, { executionLedger: new Set() }));
  record.execution = null;
  const key = `${result.artifact.workflowId}:${result.validation.validatedArtifactHash}:EXPORT_DECISION`;
  const action = getExportDecisionAction(result, { actionCache: new Map([[key, record]]) });
  assert.equal(action.status, "FAILED"); assert.equal(action.execution, null);
});
