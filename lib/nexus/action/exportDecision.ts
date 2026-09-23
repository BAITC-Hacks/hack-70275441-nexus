import type { TraceEvent } from "../agentic/types.ts";
import { checkActionPolicy } from "./policy.ts";
import { proposeExportDecision, resolveTargetRows, type EligibleWorkflowResult } from "./proposeAction.ts";
import type { ActionArtifactFile, ActionExecutionResult, ActionRecord, ActionVerificationResult, ActionWorkflowId } from "./types.ts";
import { stableHash } from "../crossSectional/tools.ts";

/**
 * Every Evidence ID the validated artifact actually contains — baseline plus on-demand — the same set the
 * policy checks `proposal.evidenceRefs` against and the verifier re-checks after execution.
 */
function knownEvidenceIds(result: EligibleWorkflowResult): Set<string> {
  if (result.kind === "TIME_SERIES") return new Set();
  const { evidence, onDemandEvidence } = result.artifact;
  return new Set([...evidence, ...onDemandEvidence].map((item) => item.id));
}

function executionKey(workflowId: ActionWorkflowId, validatedArtifactHash: string): string {
  return `${workflowId}:${validatedArtifactHash}:EXPORT_DECISION`;
}

/** CS/ET facts for the policy gate, derived from the current artifact and existing resolver. */
export function actionArtifactContext(result: Exclude<EligibleWorkflowResult, { kind: "TIME_SERIES" }>) {
  return {
    workflowId: result.artifact.workflowId,
    expectedWorkflowId: result.kind === "CROSS_SECTIONAL" ? "cross-sectional-investigation" : "event-transaction-investigation",
    target: result.kind === "CROSS_SECTIONAL" ? "highlighted_entities" : "notable_events",
    validatedArtifactHash: result.validation.validatedArtifactHash,
    artifactHash: stableHash(result.artifact),
    targetIds: resolveTargetRows(result).map(row => row.id),
  };
}

/**
 * Tracks which (workflow, validated artifact, action type) triples have already executed successfully in
 * this browser session — cleared on reload, exactly like the rest of this client-only app's state. Kept as
 * a plain module-level Set rather than any persistence layer; tests inject their own fresh Set instead of
 * sharing this singleton, so test cases never pollute each other.
 */
const sessionExecutionLedger = new Set<string>();

const immutableActionSnapshots = new WeakSet<ActionRecord>();
/** Detach and deeply freeze trusted action state, including the approved proposal and download files. */
function immutableActionSnapshot(record: ActionRecord): ActionRecord {
  if (immutableActionSnapshots.has(record)) return record;
  const copy = structuredClone(record);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy);
  immutableActionSnapshots.add(copy);
  return copy;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildFiles(result: EligibleWorkflowResult, actionId: string, proposal: ReturnType<typeof proposeExportDecision>): ActionArtifactFile[] {
  const rows = resolveTargetRows(result);
  const csvFileName = result.kind === "TIME_SERIES" ? "leading_signals.csv" : result.kind === "CROSS_SECTIONAL" ? "flagged_entities.csv" : "flagged_events.csv";
  const csvLines = result.kind === "TIME_SERIES" ? [
    "id,source_signal,target_signal,lag_periods,correlation,p_value,significant,paired_observations,ci95_lower,ci95_upper",
    ...rows.map(row => {
      const edge = row.leadingSignal!;
      return [row.id, edge.from, edge.to, String(edge.lagPeriods), String(edge.correlation), edge.pValue === null ? "" : String(edge.pValue), String(edge.significant), String(edge.n), edge.ci95 === null ? "" : String(edge.ci95.lower), edge.ci95 === null ? "" : String(edge.ci95.upper)].map(csvCell).join(",");
    }),
  ] : [
    "id,reasons,evidence_refs",
    ...rows.map((row) => [csvCell(row.id), csvCell(row.reasons.join("; ")), csvCell(row.evidenceRefs.join(" "))].join(",")),
  ];
  const csv = csvLines.join("\n");

  const decision = {
    actionId,
    type: proposal.type,
    workflowId: proposal.workflowId,
    validationStatus: result.validation.status,
    validatedArtifactHash: result.validation.validatedArtifactHash,
    target: proposal.target,
    targetIds: rows.map((row) => row.id),
    evidenceRefs: proposal.evidenceRefs,
    reason: proposal.reason,
    generatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(decision, null, 2);

  return [
    { fileName: "validated_decision.json", mimeType: "application/json", content: json, rowCount: rows.length },
    { fileName: csvFileName, mimeType: "text/csv", content: csv, rowCount: rows.length },
  ];
}

/**
 * Deterministic, no LLM: re-resolves the target from scratch (the same resolver `proposeExportDecision`
 * used) and diffs it against what was actually embedded in the generated files — the same
 * recompute-and-diff principle the cross-sectional/event validators already apply to the whole artifact,
 * applied here to the action's own output.
 */
export function verifyExecution(result: EligibleWorkflowResult, proposal: ReturnType<typeof proposeExportDecision>, files: ActionArtifactFile[]): ActionVerificationResult {
  const rows = resolveTargetRows(result);
  const jsonFile = files.find((file) => file.fileName === "validated_decision.json");
  const csvFile = files.find((file) => file.fileName !== "validated_decision.json");
  let parsedDecision: { targetIds?: unknown; validatedArtifactHash?: unknown; workflowId?: unknown; target?: unknown; type?: unknown; evidenceRefs?: unknown; validationStatus?: unknown; reason?: unknown } | null = null;
  try {
    parsedDecision = jsonFile ? JSON.parse(jsonFile.content) : null;
  } catch {
    parsedDecision = null;
  }
  const knownIds = knownEvidenceIds(result);
  const csvRowCount = csvFile?.rowCount ?? -1;

  const checks = [
    { id: "ARTIFACTS_PRESENT", passed: files.length === 2 && files.every((file) => file.content.length > 0), detail: "Both export artifacts exist in memory with non-empty content." },
    { id: "TARGET_IDS_MATCH", passed: Array.isArray(parsedDecision?.targetIds) && JSON.stringify(parsedDecision!.targetIds) === JSON.stringify(rows.map((row) => row.id)), detail: "Exported target IDs exactly match the deterministic target resolver re-run against the validated artifact." },
    { id: "ROW_COUNT_MATCHES", passed: files.every((file) => file.rowCount === rows.length) && csvRowCount === rows.length, detail: "Row counts in both files match the number of resolved target rows." },
    { id: "EVIDENCE_REFS_EXIST", passed: proposal.evidenceRefs.every((id) => knownIds.has(id)), detail: "Every cited Evidence reference resolves against the validated artifact's own Evidence." },
    { id: "VALIDATION_STATUS_VALIDATED", passed: result.validation.status === "VALIDATED", detail: "The underlying investigation artifact is VALIDATED." },
    { id: "ARTIFACT_HASH_MATCHES", passed: parsedDecision?.validatedArtifactHash === result.validation.validatedArtifactHash, detail: "The hash embedded in the export matches the validator's own validatedArtifactHash." },
    { id: "JSON_REASON_MATCHES", passed: parsedDecision?.reason === proposal.reason, detail: "The exported JSON reason exactly matches the policy-approved proposal reason." },
  ];
  if (result.kind === "TIME_SERIES") {
    const policy = checkActionPolicy({ proposal, validationStatus: result.validation.status, knownEvidenceIds: knownIds, alreadyExecuted: false, timeSeries: { workflowId: result.artifact.workflowId, artifactHash: stableHash(result.artifact), validatedArtifactHash: result.validation.validatedArtifactHash ?? "", targetIds: rows.map(row => row.id) } });
    const expectedCsv = buildFiles(result, "A-001", proposal)[1];
    checks.push(
      { id: "TIME_SERIES_POLICY", passed: policy.allowed, detail: "Recheck workflow, artifact hash, proposal target IDs and existing policy protections." },
      { id: "EXPORT_CONTRACT_MATCHES", passed: parsedDecision?.workflowId === result.artifact.workflowId && parsedDecision?.target === "leading_signals" && parsedDecision?.type === "EXPORT_DECISION" && parsedDecision?.validationStatus === "VALIDATED" && JSON.stringify(parsedDecision?.evidenceRefs) === JSON.stringify(proposal.evidenceRefs), detail: "Exported workflow, action, target and evidence contract match the validated result." },
      { id: "CSV_CONTENT_MATCHES", passed: csvFile?.fileName === expectedCsv.fileName && csvFile?.mimeType === expectedCsv.mimeType && csvFile?.content === expectedCsv.content, detail: "CSV bytes exactly match deterministic reconstruction of the validated precursor edges." },
    );
  } else {
    const context = actionArtifactContext(result);
    const policy = checkActionPolicy({ proposal, validationStatus: result.validation.status, knownEvidenceIds: knownIds, alreadyExecuted: false, artifact: context });
    // Reconstruct using the canonical proposal, never the potentially altered executed proposal.
    const expectedProposal = proposeExportDecision(result);
    const expectedCsv = buildFiles(result, "A-001", expectedProposal)[1];
    checks.push(
      { id: "ARTIFACT_POLICY", passed: policy.allowed, detail: "Recheck the actual artifact hash, workflow, target IDs and all existing policy protections." },
      { id: "EXPORT_CONTRACT_MATCHES", passed: parsedDecision?.workflowId === context.expectedWorkflowId && parsedDecision?.target === context.target && parsedDecision?.type === "EXPORT_DECISION" && parsedDecision?.validationStatus === "VALIDATED" && JSON.stringify(parsedDecision?.evidenceRefs) === JSON.stringify(expectedProposal.evidenceRefs) && JSON.stringify(proposal.evidenceRefs) === JSON.stringify(expectedProposal.evidenceRefs), detail: "Exported workflow, type, target, validation and Evidence references match the canonical artifact-derived contract." },
      { id: "CSV_CONTENT_MATCHES", passed: csvFile?.fileName === expectedCsv.fileName && csvFile?.mimeType === expectedCsv.mimeType && csvFile?.content === expectedCsv.content, detail: "CSV bytes, row values and order exactly match independent reconstruction from eligible artifact rows." },
    );
  }
  return { status: checks.every((check) => check.passed) ? "VERIFIED" : "FAILED", checks };
}

function actionTrace(actionId: string, workflowId: ActionWorkflowId, policySummary: string, execution: ActionExecutionResult | null, verification: ActionVerificationResult | null): TraceEvent[] {
  const now = () => new Date().toISOString();
  const trace: TraceEvent[] = [{ timestamp: now(), agent: "ACTION", event: "ACTION_PROPOSED", summary: `EXPORT_DECISION proposed for ${workflowId}; ${policySummary}`, source: "DETERMINISTIC" }];
  if (execution) trace.push({ timestamp: now(), agent: "ACTION", event: "ACTION_EXECUTED", summary: execution.status === "EXECUTED" ? `Generated ${execution.files.length} export artifact(s): ${execution.files.map((file) => file.fileName).join(", ")}.` : `Execution failed: ${execution.error}`, source: "DETERMINISTIC" });
  if (verification) trace.push({ timestamp: now(), agent: "ACTION", event: "ACTION_VERIFIED", summary: verification.status === "VERIFIED" ? "All deterministic verification checks passed." : `Verification failed: ${verification.checks.filter((check) => !check.passed).map((check) => check.id).join(", ")}.`, source: "DETERMINISTIC" });
  return trace;
}

/**
 * The one entry point the UI calls. Runs propose → policy → execute → verify synchronously and
 * deterministically — no network call, no async wait — and returns the finished `ActionRecord`. The UI's
 * download buttons only ever serialize `execution.files[].content`; they are never part of "execution"
 * itself, which has already happened by the time this function returns.
 */
export function runExportDecisionAction(result: EligibleWorkflowResult, options: { executionLedger?: Set<string> } = {}): ActionRecord {
  const ledger = options.executionLedger ?? sessionExecutionLedger;
  const workflowId = result.artifact.workflowId as ActionWorkflowId;
  const validatedArtifactHash = result.validation.validatedArtifactHash ?? "";
  const actionId = "A-001";
  const createdAt = new Date().toISOString();
  const investigationRef = { workflowId, validatedArtifactHash };

  // Proposal and policy both read the artifact's own shape (target rows, Evidence IDs) — a malformed
  // artifact can throw here before execution is ever attempted. Caught the same way an executor exception
  // is: reported as FAILED, never an unhandled exception and never silently treated as REJECTED (which
  // would wrongly imply the policy made a clean, deliberate decision).
  let proposal: ActionRecord["proposal"];
  let policy: ActionRecord["policy"];
  try {
    proposal = proposeExportDecision(result);
    const key = executionKey(workflowId, validatedArtifactHash);
    policy = checkActionPolicy({
      proposal,
      validationStatus: result.validation.status,
      knownEvidenceIds: knownEvidenceIds(result),
      alreadyExecuted: ledger.has(key),
      ...(result.kind === "TIME_SERIES" ? { timeSeries: { workflowId: result.artifact.workflowId, artifactHash: stableHash(result.artifact), validatedArtifactHash, targetIds: resolveTargetRows(result).map(row => row.id) } } : {}),
      ...(result.kind !== "TIME_SERIES" ? { artifact: actionArtifactContext(result) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proposal error.";
    const fallbackProposal: ActionRecord["proposal"] = { type: "EXPORT_DECISION", workflowId, target: "unknown", reason: "Action proposal could not be constructed from this artifact.", evidenceRefs: [], source: "DETERMINISTIC" };
    const fallbackPolicy: ActionRecord["policy"] = { allowed: false, status: "REJECTED", reasonCode: "PROPOSAL_CONSTRUCTION_FAILED", reason: message };
    const execution: ActionExecutionResult = { status: "FAILED", files: [], error: message };
    return { id: actionId, proposal: fallbackProposal, policy: fallbackPolicy, execution, verification: null, status: "FAILED", investigationRef, trace: actionTrace(actionId, workflowId, message, execution, null), createdAt };
  }

  if (!policy.allowed) {
    return { id: actionId, proposal, policy, execution: null, verification: null, status: "REJECTED", investigationRef, trace: actionTrace(actionId, workflowId, policy.reason, null, null), createdAt };
  }

  let execution: ActionExecutionResult;
  try {
    execution = { status: "EXECUTED", files: buildFiles(result, actionId, proposal) };
  } catch (error) {
    execution = { status: "FAILED", files: [], error: error instanceof Error ? error.message : "Unknown executor error." };
    return { id: actionId, proposal, policy, execution, verification: null, status: "FAILED", investigationRef, trace: actionTrace(actionId, workflowId, policy.reason, execution, null), createdAt };
  }

  const key = executionKey(workflowId, validatedArtifactHash);
  const verification = verifyExecution(result, proposal, execution.files);
  if (verification.status === "VERIFIED") ledger.add(key);
  const status = verification.status === "VERIFIED" ? "VERIFIED" : "FAILED";
  const record: ActionRecord = { id: actionId, proposal, policy, execution, verification, status, investigationRef, trace: actionTrace(actionId, workflowId, policy.reason, execution, verification), createdAt };
  return status === "VERIFIED" ? immutableActionSnapshot(record) : record;
}

/**
 * Caches one `ActionRecord` per (workflow, validated artifact hash) — module-level, in-memory, cleared on
 * reload, exactly like `sessionExecutionLedger` above; not a persistence layer.
 *
 * `runExportDecisionAction` is not safe to call directly from `useMemo`/component render: it mutates
 * `sessionExecutionLedger` as a real, intentional side effect (see its own docs), and React does not
 * guarantee a `useMemo` calculation runs exactly once for a given input — Strict Mode deliberately
 * double-invokes it in development, and any future render with an unchanged `results` reference could
 * call it again too. A second call for the artifact it just itself executed would see its own prior run
 * already in the ledger and incorrectly reject itself as DUPLICATE_EXECUTION, turning a VERIFIED result
 * into a REJECTED one for no reason visible to the user.
 *
 * This wrapper makes repeat calls for the SAME validated artifact idempotent instead: the side-effecting
 * pipeline runs exactly once per hash, and every later call for that identical artifact returns the same
 * cached record (whatever its status — VERIFIED, REJECTED or FAILED — a hash that was BLOCKED once will be
 * BLOCKED again, so there is nothing to gain by re-attempting it). A different `validatedArtifactHash` is a
 * genuine cache miss and runs — and executes — as a real, independent action, exactly as before.
 */
const actionRecordCache = new Map<string, ActionRecord>();

export function getExportDecisionAction(result: EligibleWorkflowResult, options: { executionLedger?: Set<string>; actionCache?: Map<string, ActionRecord> } = {}): ActionRecord {
  const cache = options.actionCache ?? actionRecordCache;
  // A cached successful action cannot authorize a changed or blocked TIME_SERIES artifact.
  if (result.kind === "TIME_SERIES" && (result.validation.status !== "VALIDATED" || result.artifact.workflowId !== "generic-time-series-investigation" || stableHash(result.artifact) !== result.validation.validatedArtifactHash)) return runExportDecisionAction(result, { executionLedger: options.executionLedger });
  if (result.kind !== "TIME_SERIES") {
    try {
      const context = actionArtifactContext(result);
      const previous = cache.get(executionKey(result.artifact.workflowId as ActionWorkflowId, result.validation.validatedArtifactHash));
      if (context.workflowId !== context.expectedWorkflowId || context.artifactHash !== context.validatedArtifactHash || result.validation.status !== "VALIDATED" && previous?.status === "VERIFIED") return runExportDecisionAction(result, { executionLedger: options.executionLedger });
    } catch {
      return runExportDecisionAction(result, { executionLedger: options.executionLedger });
    }
  }
  const key = executionKey(result.artifact.workflowId as ActionWorkflowId, result.validation.validatedArtifactHash ?? "");
  const cached = cache.get(key);
  if (cached) {
    if (cached.status !== "VERIFIED") return cached;
    let verification: ActionVerificationResult;
    try {
      verification = verifyExecution(result, cached.proposal, cached.execution?.files ?? []);
    } catch {
      verification = { status: "FAILED", checks: [{ id: "CACHE_REVERIFICATION", passed: false, detail: "Cached execution could not be safely reverified." }] };
    }
    if (verification.status === "VERIFIED") {
      const snapshot = immutableActionSnapshot(cached);
      cache.set(key, snapshot);
      return snapshot;
    }
    const failed = immutableActionSnapshot({ ...cached, status: "FAILED", verification, trace: [...cached.trace, { timestamp: new Date().toISOString(), agent: "ACTION", event: "ACTION_VERIFIED", source: "DETERMINISTIC", summary: `Cached action integrity check failed: ${verification.checks.filter(check => !check.passed).map(check => check.id).join(", ")}.` }] });
    cache.set(key, failed);
    return failed;
  }
  const record = runExportDecisionAction(result, { executionLedger: options.executionLedger });
  cache.set(key, record);
  return record;
}
