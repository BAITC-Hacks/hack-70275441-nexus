import { test } from "node:test";
import assert from "node:assert/strict";
import { bankClients, eventActivityFixture } from "../universal/fixtures.ts";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import { runEventTransactionInvestigation } from "../eventTransaction/workflow.ts";
import type { CrossSectionalAgentRuns } from "../crossSectional/agents.ts";
import type { EventAgentRuns } from "../eventTransaction/agents.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { proposeExportDecision, resolveTargetRows } from "./proposeAction.ts";
import { checkActionPolicy } from "./policy.ts";
import { actionArtifactContext, getExportDecisionAction, runExportDecisionAction, verifyExecution } from "./exportDecision.ts";
import type { ActionRecord, ActionProposal } from "./types.ts";

const fallback = async (): Promise<CrossSectionalAgentRuns & EventAgentRuns> => ({ llmCalls: 0, agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "Descriptive patterns warrant inspection.", alternativeExplanation: "Collection practices may explain the pattern.", rationale: "Only deterministic evidence supports inspection.", evidenceRefs: ["E-001"] },
  skeptic: { source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Confounding and collection artifacts remain plausible.", alternativeExplanation: "Patterns need domain review.", evidenceRefs: ["E-001"] },
});
function government(): UploadedDataset {
  const rows = Array.from({ length: 60 }, (_, i) => ({ request_id: `R-${i}`, submitted_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), appeal_type: "initial", service_type: i < 10 ? "Delayed A" : i < 20 ? "Delayed B" : "Normal", department: "Department", processing_days: i < 10 ? 30 : i < 20 ? 20 : 2, repeat_request: i < 20 }));
  return { name: "government-parity.csv", columns: Object.keys(rows[0]), rows };
}
const factories = {
  CS: () => runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, fallback),
  ET: () => runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallback),
  Government: () => runEventTransactionInvestigation({ dataset: government(), signals: [] }, fallback),
};

for (const [name, factory] of Object.entries(factories)) {
  test(`${name}: unchanged eligible rows reach VERIFIED with byte-exact reconstruction`, async () => {
    const result = await factory(); const before = JSON.stringify(result.artifact);
    const proposal = proposeExportDecision(result); const rows = resolveTargetRows(result);
    assert.equal(result.validation.status, "VALIDATED"); assert.ok(rows.length >= 2);
    assert.deepEqual(proposal.targetIds, rows.map(row => row.id));
    assert.equal(proposal.validatedArtifactHash, result.validation.validatedArtifactHash);
    const action = runExportDecisionAction(result, { executionLedger: new Set() });
    assert.equal(action.policy.status, "POLICY_APPROVED"); assert.equal(action.execution?.status, "EXECUTED"); assert.equal(action.status, "VERIFIED");
    assert.ok(action.verification?.checks.every(check => check.passed));
    assert.equal(JSON.stringify(result.artifact), before);
    const again = runExportDecisionAction(result, { executionLedger: new Set() });
    assert.equal(action.execution!.files[1].content, again.execution!.files[1].content);
  });
  test(`${name}: policy rejects hash, target-ID, workflow, target and type mismatch`, async () => {
    const result = await factory(); const proposal = proposeExportDecision(result); const context = actionArtifactContext(result);
    const check = (value: ActionProposal, artifact: NonNullable<Parameters<typeof checkActionPolicy>[0]["artifact"]> = context) => checkActionPolicy({ proposal: value, validationStatus: "VALIDATED", knownEvidenceIds: new Set([...result.artifact.evidence, ...result.artifact.onDemandEvidence].map(item => item.id)), alreadyExecuted: false, artifact });
    assert.equal(check(proposal).status, "POLICY_APPROVED");
    for (const patch of [{ validatedArtifactHash: "invalid" }, { targetIds: ["unknown"] }, { targetIds: [...proposal.targetIds!].reverse() }, { workflowId: result.kind === "CROSS_SECTIONAL" ? "event-transaction-investigation" : "cross-sectional-investigation" }, { target: "unknown" }, { type: "OTHER" }]) {
      assert.equal(check({ ...proposal, ...patch } as ActionProposal).status, "REJECTED");
    }
    assert.equal(check(proposal, { ...context, artifactHash: "changed" }).status, "REJECTED");
    assert.equal(check(proposal, { ...context, workflowId: "other" }).status, "REJECTED");
    assert.equal(checkActionPolicy({ proposal, validationStatus: "VALIDATED", knownEvidenceIds: new Set(proposal.evidenceRefs), alreadyExecuted: false }).status, "REJECTED");
    const invalid = { ...result, validation: { ...result.validation, validatedArtifactHash: "invalid" } };
    assert.equal(runExportDecisionAction(invalid, { executionLedger: new Set() }).status, "REJECTED");
  });
  test(`${name}: verification rejects row values, order and any changed CSV bytes`, async () => {
    const result = await factory(); const action = runExportDecisionAction(result, { executionLedger: new Set() });
    const csv = action.execution!.files[1].content; const lines = csv.split("\n");
    for (const changed of [csv.replace(lines[1], lines[1] + "modified"), [lines[0], ...lines.slice(1).reverse()].join("\n"), csv.replaceAll("\n", "\r\n"), csv + " ", csv.replace(/,/, ";")]) {
      const files = structuredClone(action.execution!.files); files[1].content = changed;
      const verification = verifyExecution(result, action.proposal, files);
      assert.equal(verification.status, "FAILED");
      assert.equal(verification.checks.find(check => check.id === "CSV_CONTENT_MATCHES")?.passed, false);
    }
  });
  test(`${name}: verification rejects altered export contract and proposal`, async () => {
    const result = await factory(); const action = runExportDecisionAction(result, { executionLedger: new Set() });
    for (const patch of [{ validatedArtifactHash: "invalid" }, { targetIds: ["unknown"] }, { targetIds: [...action.proposal.targetIds!].reverse() }, { workflowId: "other" }, { target: "other" }, { type: "OTHER" }, { evidenceRefs: [] }]) {
      const files = structuredClone(action.execution!.files); files[0].content = JSON.stringify({ ...JSON.parse(files[0].content), ...patch });
      assert.equal(verifyExecution(result, action.proposal, files).status, "FAILED");
    }
    assert.equal(verifyExecution(result, { ...action.proposal, targetIds: ["unknown"] }, action.execution!.files).status, "FAILED");
  });
  test(`${name}: changed or blocked artifact cannot reuse a cached VERIFIED action`, async () => {
    const result = await factory(); const cache = new Map<string, ActionRecord>(); const ledger = new Set<string>();
    const options = { actionCache: cache, executionLedger: ledger };
    const record = getExportDecisionAction(result, options); assert.equal(record.status, "VERIFIED");
    assert.equal(getExportDecisionAction(result, options), record);
    const modified = structuredClone(result); modified.artifact.observerFindings.push("changed");
    assert.equal(getExportDecisionAction(modified, options).status, "REJECTED");
    assert.equal(verifyExecution(modified, record.proposal, record.execution!.files).status, "FAILED");
    assert.equal(getExportDecisionAction({ ...result, validation: { ...result.validation, status: "BLOCKED" } }, options).status, "REJECTED");
  });
}
