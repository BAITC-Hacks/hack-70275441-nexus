import { test } from "node:test";
import assert from "node:assert/strict";
import { bankClients, bankFixtureMetadata, eventActivityFixture } from "../universal/fixtures.ts";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import type { CrossSectionalAgentRuns } from "../crossSectional/agents.ts";
import { runEventTransactionInvestigation } from "../eventTransaction/workflow.ts";
import type { EventAgentRuns } from "../eventTransaction/agents.ts";
import { checkActionPolicy as checkArtifactPolicy } from "./policy.ts";
import { proposeExportDecision, resolveTargetRows } from "./proposeAction.ts";
import { getExportDecisionAction, runExportDecisionAction, verifyExecution } from "./exportDecision.ts";
import type { ActionProposal, ActionRecord } from "./types.ts";

const fallbackCrossSectionalAgents = async (_analysis: unknown, evidence: Array<{ id: string }>): Promise<CrossSectionalAgentRuns> => ({
  llmCalls: 0,
  agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "calculate_cross_sectional_associations", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Target construction or confounding may explain the pattern.", rationale: "Interpretation is restricted to deterministic Evidence.", evidenceRefs: [evidence.find((item) => item.id === "E-004")!.id] },
  skeptic: { source: "FALLBACK", selectedTool: "inspect_target_provenance", status: "CHALLENGED", challenge: "The supplied score reuses inspected predictors, so the association may be circular and is not causal.", alternativeExplanation: "Score construction, subgroup size and confounding remain plausible.", evidenceRefs: [evidence.find((item) => item.id === "E-007")?.id ?? evidence[0].id] },
});
const fallbackEventAgents = async (): Promise<EventAgentRuns> => ({
  llmCalls: 0,
  agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "A subset of entity activity warrants review under published rules.", alternativeExplanation: "Benign batching or retries may explain the concentration.", rationale: "Interpretation uses Evidence references only.", evidenceRefs: ["E-007"] },
  skeptic: { source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Duplication, collection artifacts, timestamp quality and a limited baseline may explain the pattern.", alternativeExplanation: "Normal automation remains plausible.", evidenceRefs: ["E-004"] },
});

async function validatedCrossSectionalResult() {
  return runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, fallbackCrossSectionalAgents);
}
async function validatedEventResult() {
  return runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallbackEventAgents);
}

// ---- Policy: pure unit tests ----

function baseProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return { type: "EXPORT_DECISION", workflowId: "cross-sectional-investigation", target: "highlighted_entities", reason: "Export the flagged entities.", evidenceRefs: ["E-005"], source: "DETERMINISTIC", validatedArtifactHash: "fnv1a-policy-fixture", targetIds: ["C-001"], ...overrides };
}
// Supply the newly required artifact binding; existing protection assertions stay unchanged.
function checkActionPolicy(input: Parameters<typeof checkArtifactPolicy>[0]) {
  return checkArtifactPolicy({ ...input, artifact: { workflowId: "cross-sectional-investigation", expectedWorkflowId: "cross-sectional-investigation", target: "highlighted_entities", validatedArtifactHash: "fnv1a-policy-fixture", artifactHash: "fnv1a-policy-fixture", targetIds: ["C-001"] } });
}
const knownIds = new Set(["E-001", "E-002", "E-003", "E-004", "E-005"]);

test("policy: a VALIDATED artifact with a legitimate proposal is approved", () => {
  const result = checkActionPolicy({ proposal: baseProposal(), validationStatus: "VALIDATED", knownEvidenceIds: knownIds, alreadyExecuted: false });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "POLICY_APPROVED");
});

test("policy: an unvalidated artifact is rejected", () => {
  const result = checkActionPolicy({ proposal: baseProposal(), validationStatus: "BLOCKED", knownEvidenceIds: knownIds, alreadyExecuted: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "VALIDATION_NOT_PASSED");
});

test("policy: an invalid target is rejected", () => {
  const result = checkActionPolicy({ proposal: baseProposal({ target: "everything" }), validationStatus: "VALIDATED", knownEvidenceIds: knownIds, alreadyExecuted: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "INVALID_TARGET");
});

test("policy: an Evidence reference outside the validated artifact is rejected", () => {
  const result = checkActionPolicy({ proposal: baseProposal({ evidenceRefs: ["E-999"] }), validationStatus: "VALIDATED", knownEvidenceIds: knownIds, alreadyExecuted: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "INVALID_EVIDENCE_REFERENCE");
});

test("policy: a reason asserting a causal claim is rejected", () => {
  const result = checkActionPolicy({ proposal: baseProposal({ reason: "This pattern causes portfolio losses." }), validationStatus: "VALIDATED", knownEvidenceIds: knownIds, alreadyExecuted: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "CAUSAL_OVERCLAIM_IN_REASON");
});

test("policy: an already-executed action for the same artifact is rejected as a duplicate", () => {
  const result = checkActionPolicy({ proposal: baseProposal(), validationStatus: "VALIDATED", knownEvidenceIds: knownIds, alreadyExecuted: true });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "DUPLICATE_EXECUTION");
});

test("policy: no numeric or causal authority is introduced by the deterministic proposal reason", () => {
  const proposal = baseProposal();
  assert.doesNotMatch(proposal.reason, /\d/);
  assert.doesNotMatch(proposal.reason, /\b(causes?|proves?)\b/i);
});

// ---- End-to-end: CROSS_SECTIONAL ----

test("end-to-end CROSS_SECTIONAL: a validated artifact produces a VERIFIED action with exact targets, evidence and hash", async () => {
  const result = await validatedCrossSectionalResult();
  const ledger = new Set<string>();
  const action = runExportDecisionAction(result, { executionLedger: ledger });

  assert.equal(action.id, "A-001");
  assert.equal(action.status, "VERIFIED");
  assert.equal(action.policy.status, "POLICY_APPROVED");
  assert.equal(action.execution?.status, "EXECUTED");
  assert.equal(action.verification?.status, "VERIFIED");
  assert.ok(action.verification?.checks.every((check) => check.passed));

  const rows = resolveTargetRows(result);
  assert.deepEqual(rows.map((row) => row.id), ["C-012", "C-011", "C-010", "C-009"]);

  const files = action.execution!.files;
  assert.equal(files.length, 2);
  const json = files.find((file) => file.fileName === "validated_decision.json")!;
  const csv = files.find((file) => file.fileName === "flagged_entities.csv")!;
  assert.ok(json && csv);

  const decision = JSON.parse(json.content);
  assert.deepEqual(decision.targetIds, rows.map((row) => row.id));
  assert.equal(decision.validatedArtifactHash, result.validation.validatedArtifactHash);
  assert.deepEqual(decision.evidenceRefs, ["E-005"]);
  assert.equal(json.rowCount, rows.length);
  assert.equal(csv.rowCount, rows.length);
  assert.equal(csv.content.split("\n").length - 1, rows.length);
  assert.ok(csv.content.startsWith("id,reasons,evidence_refs"));
  assert.ok(csv.content.includes("C-012"));

  assert.deepEqual(action.trace.map((entry) => entry.event), ["ACTION_PROPOSED", "ACTION_EXECUTED", "ACTION_VERIFIED"]);
  assert.ok(action.trace.every((entry) => entry.agent === "ACTION"));
});

test("end-to-end EVENT_TRANSACTION: a validated artifact produces a VERIFIED action with exact targets, evidence and hash", async () => {
  const result = await validatedEventResult();
  const ledger = new Set<string>();
  const action = runExportDecisionAction(result, { executionLedger: ledger });

  assert.equal(action.status, "VERIFIED");
  const rows = resolveTargetRows(result);
  assert.equal(rows.length, 8);

  const files = action.execution!.files;
  const json = files.find((file) => file.fileName === "validated_decision.json")!;
  const csv = files.find((file) => file.fileName === "flagged_events.csv")!;
  assert.ok(json && csv);

  const decision = JSON.parse(json.content);
  assert.deepEqual(decision.targetIds, rows.map((row) => row.id));
  assert.equal(decision.validatedArtifactHash, result.validation.validatedArtifactHash);
  assert.deepEqual(decision.evidenceRefs, ["E-006"]);
  assert.equal(csv.content.split("\n").length - 1, rows.length);
});

// ---- FALLBACK eligibility ----

test("a FALLBACK-sourced but VALIDATED cross-sectional artifact is still eligible for the action (eligibility depends on validator status, not investigator/skeptic source)", async () => {
  const result = await validatedCrossSectionalResult();
  assert.equal(result.artifact.investigator.source, "FALLBACK");
  assert.equal(result.artifact.skeptic.source, "FALLBACK");
  assert.equal(result.validation.status, "VALIDATED");
  const action = runExportDecisionAction(result, { executionLedger: new Set() });
  assert.equal(action.status, "VERIFIED");
});

// ---- Duplicate execution end-to-end ----

test("running the action twice for the identical validated artifact rejects the second attempt as a duplicate", async () => {
  const result = await validatedCrossSectionalResult();
  const ledger = new Set<string>();
  const first = runExportDecisionAction(result, { executionLedger: ledger });
  assert.equal(first.status, "VERIFIED");
  const second = runExportDecisionAction(result, { executionLedger: ledger });
  assert.equal(second.status, "REJECTED");
  assert.equal(second.policy.reasonCode, "DUPLICATE_EXECUTION");
});

// ---- Verification catches tampering ----

test("a tampered exported file (hash rewritten after generation) fails verification rather than reporting success", async () => {
  const result = await validatedCrossSectionalResult();
  const action = runExportDecisionAction(result, { executionLedger: new Set() });
  assert.equal(action.status, "VERIFIED");
  const files = action.execution!.files;
  const tamperedJson = JSON.parse(files.find((file) => file.fileName === "validated_decision.json")!.content);
  tamperedJson.validatedArtifactHash = "fnv1a-tampered0";
  const tamperedFiles = files.map((file) => (file.fileName === "validated_decision.json" ? { ...file, content: JSON.stringify(tamperedJson) } : file));
  const verification = verifyExecution(result, action.proposal, tamperedFiles);
  assert.equal(verification.status, "FAILED");
  assert.equal(verification.checks.find((check) => check.id === "ARTIFACT_HASH_MATCHES")?.passed, false);
  assert.ok(verification.checks.filter((check) => check.id !== "ARTIFACT_HASH_MATCHES").every((check) => check.passed), "tampering only the hash must not fail unrelated checks");
});

test("a tampered target-ID list in the exported file fails verification", async () => {
  const result = await validatedCrossSectionalResult();
  const action = runExportDecisionAction(result, { executionLedger: new Set() });
  const files = action.execution!.files;
  const tamperedJson = JSON.parse(files.find((file) => file.fileName === "validated_decision.json")!.content);
  tamperedJson.targetIds = ["C-999"];
  const tamperedFiles = files.map((file) => (file.fileName === "validated_decision.json" ? { ...file, content: JSON.stringify(tamperedJson) } : file));
  const verification = verifyExecution(result, action.proposal, tamperedFiles);
  assert.equal(verification.status, "FAILED");
  assert.equal(verification.checks.find((check) => check.id === "TARGET_IDS_MATCH")?.passed, false);
});

test("an unvalidated artifact never reaches execution — the action is REJECTED, not silently attempted", async () => {
  const result = await validatedCrossSectionalResult();
  const blocked = structuredClone(result);
  blocked.validation.status = "BLOCKED";
  const action = runExportDecisionAction(blocked, { executionLedger: new Set() });
  assert.equal(action.status, "REJECTED");
  assert.equal(action.execution, null);
  assert.equal(action.verification, null);
});

test("an executor exception (malformed artifact) is caught and reported as FAILED, never an unhandled exception", async () => {
  const result = await validatedCrossSectionalResult();
  const broken = structuredClone(result);
  // @ts-expect-error deliberately corrupting the artifact to force the target resolver to throw
  delete broken.artifact.analysis.highRisk;
  const action = runExportDecisionAction(broken, { executionLedger: new Set() });
  assert.equal(action.status, "FAILED");
  assert.equal(action.execution?.status, "FAILED");
  assert.ok(action.execution?.error);
});

test("proposeExportDecision never invents a target row or Evidence reference not already in the validated artifact, and never asserts a causal claim", async () => {
  const result = await validatedCrossSectionalResult();
  const proposal = proposeExportDecision(result);
  const knownEvidence = new Set(result.artifact.evidence.map((item) => item.id));
  assert.ok(proposal.evidenceRefs.every((id) => knownEvidence.has(id)));
  const rows = resolveTargetRows(result);
  // A plain count of how many rows are being exported is legitimate deterministic metadata (the same kind
  // of count the UI already shows freely) — it is not the kind of fabricated/authoritative statistic
  // (a correlation, a percentage, a threshold) the analytical layer's own numeric-authority guards forbid.
  assert.match(proposal.reason, new RegExp(String(rows.length)));
  assert.doesNotMatch(proposal.reason, /\b(causes?|caused|proves?|proving|confirms?)\b/i);
  assert.doesNotMatch(proposal.reason, /%|correlation|threshold/i);
});

// ---- React-safety regression: getExportDecisionAction must be idempotent per validated artifact hash ----
// (fixes the useMemo-calls-runExportDecisionAction-directly bug, where React's Strict Mode double-invoke,
// or any re-render with an unchanged `results` reference, could call the side-effecting pipeline twice and
// have the second call reject itself as DUPLICATE_EXECUTION.)

test("calling getExportDecisionAction twice for the SAME validated artifact hash returns the identical cached VERIFIED record, not a DUPLICATE_EXECUTION rejection", async () => {
  const result = await validatedCrossSectionalResult();
  const ledger = new Set<string>();
  const cache = new Map<string, ActionRecord>();

  const first = getExportDecisionAction(result, { executionLedger: ledger, actionCache: cache });
  assert.equal(first.status, "VERIFIED");

  // Simulate React calling the memo calculation again for the same `results` reference — e.g. Strict
  // Mode's deliberate double-invoke, or an unrelated parent re-render that doesn't change `results`.
  const second = getExportDecisionAction(result, { executionLedger: ledger, actionCache: cache });
  assert.equal(second.status, "VERIFIED", "a second lookup for the same artifact must stay VERIFIED, never flip to REJECTED");
  assert.equal(second, first, "the second call must return the exact same cached record, not a freshly re-executed one");

  // And a third time, for good measure — idempotent regardless of call count.
  const third = getExportDecisionAction(result, { executionLedger: ledger, actionCache: cache });
  assert.equal(third, first);
});

test("a different validated artifact (different hash) still produces its own independent action, not a cache collision", async () => {
  const csResult = await validatedCrossSectionalResult();
  const evtResult = await validatedEventResult();
  assert.notEqual(csResult.validation.validatedArtifactHash, evtResult.validation.validatedArtifactHash);

  const ledger = new Set<string>();
  const cache = new Map<string, ActionRecord>();
  const csAction = getExportDecisionAction(csResult, { executionLedger: ledger, actionCache: cache });
  const evtAction = getExportDecisionAction(evtResult, { executionLedger: ledger, actionCache: cache });

  assert.equal(csAction.status, "VERIFIED");
  assert.equal(evtAction.status, "VERIFIED");
  assert.notEqual(csAction, evtAction);
  assert.equal(csAction.investigationRef.workflowId, "cross-sectional-investigation");
  assert.equal(evtAction.investigationRef.workflowId, "event-transaction-investigation");
  assert.equal(cache.size, 2, "two distinct hashes must produce two distinct cache entries");
});

test("a cached REJECTED/FAILED record is also returned as-is on a repeat lookup, not silently re-attempted", async () => {
  const result = await validatedCrossSectionalResult();
  const blocked = structuredClone(result);
  blocked.validation.status = "BLOCKED";
  const ledger = new Set<string>();
  const cache = new Map<string, ActionRecord>();

  const first = getExportDecisionAction(blocked, { executionLedger: ledger, actionCache: cache });
  assert.equal(first.status, "REJECTED");
  const second = getExportDecisionAction(blocked, { executionLedger: ledger, actionCache: cache });
  assert.equal(second, first);
});
