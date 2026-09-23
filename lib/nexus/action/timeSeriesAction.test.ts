import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeGeneric } from "../adapters/generic/analyze.ts";
import { buildPrecursorChain } from "../agentic/precursorChain.ts";
import { syntheticConstructionDataset } from "../construction/dataset.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import { stableHash } from "../crossSectional/tools.ts";
import type { AdmissionRequest } from "../universal/contracts.ts";
import { createTimeSeriesArtifact, validateTimeSeriesArtifact } from "../timeSeries/validator.ts";
import { proposeExportDecision, resolveTargetRows, type TimeSeriesActionResult } from "./proposeAction.ts";
import { checkActionPolicy } from "./policy.ts";
import { getExportDecisionAction, runExportDecisionAction, verifyExecution } from "./exportDecision.ts";
import type { ActionProposal, ActionRecord } from "./types.ts";

function original(kind: "construction" | "fintech"): AdmissionRequest {
  const dataset = kind === "construction" ? syntheticConstructionDataset() : fintechDemoDataset();
  return { dataset, signals: dataset.columns.filter(column => column !== "date" && column !== "month"), taskId: kind, mapping: { target: kind === "construction" ? "schedule_gap_pp" : "portfolio_risk" } };
}
function result(input = original("construction")): TimeSeriesActionResult {
  const analysis = analyzeGeneric(input.dataset, input.signals);
  const artifact = createTimeSeriesArtifact(input, { analysis, precursorChain: buildPrecursorChain(input.dataset, analysis, input.mapping?.target) });
  return { kind: "TIME_SERIES", artifact, validation: validateTimeSeriesArtifact(input, artifact) };
}
function policy(workflow: TimeSeriesActionResult, proposal = proposeExportDecision(workflow)) {
  return checkActionPolicy({ proposal, validationStatus: workflow.validation.status, knownEvidenceIds: new Set(), alreadyExecuted: false, timeSeries: { workflowId: workflow.artifact.workflowId, artifactHash: stableHash(workflow.artifact), validatedArtifactHash: workflow.validation.validatedArtifactHash ?? "", targetIds: resolveTargetRows(workflow).map(row => row.id) } });
}
for (const kind of ["construction", "fintech"] as const) {
  test(`${kind}: validated deterministic proposal reaches POLICY_APPROVED, EXECUTED, VERIFIED`, () => {
    const workflow = result(original(kind));
    assert.equal(workflow.validation.status, "VALIDATED");
    const proposal = proposeExportDecision(workflow);
    assert.equal(proposal.workflowId, "generic-time-series-investigation");
    assert.equal(proposal.target, "leading_signals");
    assert.deepEqual(proposal.evidenceRefs, []);
    assert.equal(proposal.validatedArtifactHash, workflow.validation.validatedArtifactHash);
    assert.deepEqual(proposal.targetIds, resolveTargetRows(workflow).map(row => row.id));
    assert.equal(policy(workflow, proposal).status, "POLICY_APPROVED");
    const action = runExportDecisionAction(workflow, { executionLedger: new Set() });
    assert.equal(action.trace[0].event, "ACTION_PROPOSED");
    assert.equal(action.policy.status, "POLICY_APPROVED");
    assert.equal(action.execution?.status, "EXECUTED");
    assert.equal(action.verification?.status, "VERIFIED");
    assert.equal(action.status, "VERIFIED");
    assert.ok(action.verification?.checks.every(check => check.passed));
    assert.deepEqual(action.execution!.files.map(file => file.fileName), ["validated_decision.json", "leading_signals.csv"]);
    assert.ok(resolveTargetRows(workflow).length > 0);
    assert.ok(action.execution!.files.every(file => file.rowCount === workflow.artifact.precursorChain.edges.length));
    const csv = action.execution!.files[1].content;
    workflow.artifact.precursorChain.edges.forEach((edge, i) => {
      assert.deepEqual(csv.split("\n")[i + 1].split(","), [resolveTargetRows(workflow)[i].id, edge.from, edge.to, String(edge.lagPeriods), String(edge.correlation), edge.pValue === null ? "" : String(edge.pValue), String(edge.significant), String(edge.n), edge.ci95 === null ? "" : String(edge.ci95.lower), edge.ci95 === null ? "" : String(edge.ci95.upper)]);
    });
  });
}
test("identical inputs preserve target IDs, artifact hash, order and CSV bytes", () => {
  const a = result(); const b = result();
  assert.deepEqual(resolveTargetRows(a), resolveTargetRows(b));
  assert.equal(a.validation.validatedArtifactHash, b.validation.validatedArtifactHash);
  const execute = (value: TimeSeriesActionResult) => runExportDecisionAction(value, { executionLedger: new Set() }).execution!.files[1].content;
  assert.equal(execute(a), execute(b));
});
for (const [name, mutate] of [
  ["tampered proposal hash", (proposal: ActionProposal) => { proposal.validatedArtifactHash = "fnv1a-invalid"; }],
  ["unknown target ID", (proposal: ActionProposal) => { proposal.targetIds = ["unknown"]; }],
  ["wrong workflow", (proposal: ActionProposal) => { proposal.workflowId = "cross-sectional-investigation"; proposal.target = "highlighted_entities"; }],
  ["wrong target type", (proposal: ActionProposal) => { proposal.target = "notable_events"; }],
  ["invented Evidence", (proposal: ActionProposal) => { proposal.evidenceRefs = ["E-001"]; }],
  ["causal reason", (proposal: ActionProposal) => { proposal.reason = "This signal causes the outcome."; }],
] as const) {
  test(`policy rejects ${name}`, () => {
    const workflow = result(); const proposal = proposeExportDecision(workflow); mutate(proposal);
    assert.equal(policy(workflow, proposal).status, "REJECTED");
  });
}
test("actual artifact/hash and workflow tampering cannot execute", () => {
  const workflow = result();
  const modifiedHash = { ...workflow, validation: { ...workflow.validation, validatedArtifactHash: "fnv1a-invalid" } };
  const modifiedArtifact = JSON.parse(JSON.stringify(workflow)) as TimeSeriesActionResult;
  (modifiedArtifact.artifact.precursorChain as unknown as { riskIndicator: number }).riskIndicator += 1;
  const modifiedWorkflow = JSON.parse(JSON.stringify(workflow)) as TimeSeriesActionResult;
  (modifiedWorkflow.artifact as unknown as { workflowId: string }).workflowId = "event-transaction-investigation";
  for (const value of [modifiedHash, modifiedArtifact, modifiedWorkflow]) {
    const action = runExportDecisionAction(value, { executionLedger: new Set() });
    assert.equal(action.status, "REJECTED"); assert.equal(action.execution, null);
  }
});
test("blocked or missing validated hash never executes", () => {
  const workflow = result();
  for (const validation of [{ status: "BLOCKED" as const, checks: [] }, { status: "VALIDATED" as const, checks: [] }]) {
    assert.equal(runExportDecisionAction({ ...workflow, validation }, { executionLedger: new Set() }).status, "REJECTED");
  }
});
test("verification rejects exported hash, ID, workflow, target, type and CSV-statistic tampering", () => {
  const workflow = result(); const action = runExportDecisionAction(workflow, { executionLedger: new Set() });
  for (const patch of [{ validatedArtifactHash: "invalid" }, { targetIds: ["unknown"] }, { workflowId: "event-transaction-investigation" }, { target: "notable_events" }, { type: "OTHER" }]) {
    const files = structuredClone(action.execution!.files); const decision = JSON.parse(files[0].content);
    files[0].content = JSON.stringify({ ...decision, ...patch });
    assert.equal(verifyExecution(workflow, action.proposal, files).status, "FAILED");
  }
  const files = structuredClone(action.execution!.files); files[1].content = files[1].content.replace(/,true,|,false,/, ",invented,");
  assert.equal(verifyExecution(workflow, action.proposal, files).status, "FAILED");
});
test("duplicate protection and cached idempotence remain intact without trusting a changed artifact", () => {
  const workflow = result(); const ledger = new Set<string>(); const cache = new Map<string, ActionRecord>();
  const action = getExportDecisionAction(workflow, { executionLedger: ledger, actionCache: cache });
  assert.equal(action.status, "VERIFIED");
  assert.equal(getExportDecisionAction(workflow, { executionLedger: ledger, actionCache: cache }), action);
  assert.equal(runExportDecisionAction(workflow, { executionLedger: ledger }).policy.reasonCode, "DUPLICATE_EXECUTION");
  const changed = { ...workflow, artifact: { ...workflow.artifact, dataset: { ...workflow.artifact.dataset, name: "changed" } } };
  assert.equal(getExportDecisionAction(changed, { executionLedger: ledger, actionCache: cache }).status, "REJECTED");
});
test("action wording does not overclaim causality or reference agent-selected Evidence", () => {
  const workflow = result(); const proposal = proposeExportDecision(workflow);
  assert.doesNotMatch(proposal.reason, /\b(causes?|caused|proven cause|causal driver)\b/i);
  assert.ok(resolveTargetRows(workflow).every(row => row.evidenceRefs.length === 0));
  const action = runExportDecisionAction(workflow, { executionLedger: new Set() });
  assert.ok(action.execution!.files.every(file => !/\b(causes?|proven cause|causal driver)\b/i.test(file.content)));
});
test("separator, quote and multiline signal names keep collision-safe IDs and verified CSV", () => {
  const input = original("construction"); const column = result(input).artifact.precursorChain.edges[0].from;
  const renamed = 'signal::with,quote"and\nnewline';
  input.dataset.columns = input.dataset.columns.map(value => value === column ? renamed : value);
  input.dataset.rows = input.dataset.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key === column ? renamed : key, value])));
  input.signals = input.signals.map(value => value === column ? renamed : value);
  const workflow = result(input); const rows = resolveTargetRows(workflow);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.some(row => row.id.startsWith(encodeURIComponent(renamed))));
  const action = runExportDecisionAction(workflow, { executionLedger: new Set() });
  assert.equal(action.status, "VERIFIED"); assert.ok(action.execution!.files[1].content.includes('"signal::with,quote""and\nnewline"'));
});
test("TIME_SERIES UI retains the API artifact/validation and runs the existing panel on user request", () => {
  const source = readFileSync(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  const branch = source.split('message.kind === "TIME_SERIES"')[1].split('if (eventType === "error")')[0];
  assert.match(branch, /message\.artifact && message\.validation/);
  assert.match(branch, /artifact: message\.artifact/);
  assert.match(branch, /validation: message\.validation/);
  const view = source.split("function ResultsView(")[1];
  assert.match(view, /Результат проверен: \{decision\.validationStatus\}/);
  assert.match(view, /onClick=\{\(\) => setAction\(getExportDecisionAction\(results\)\)\}/);
  assert.match(view, /<NextActionPanel action=\{action\}/);
});
