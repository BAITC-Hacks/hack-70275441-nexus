import type { ActionPolicyResult, ActionProposal, ActionWorkflowId } from "./types.ts";

export const ALLOWED_WORKFLOWS: ActionWorkflowId[] = ["cross-sectional-investigation", "event-transaction-investigation", "generic-time-series-investigation"];

/** Allowed deterministic targets — see `proposeAction.ts` for resolution. */
export const ALLOWED_TARGETS: Record<ActionWorkflowId, string[]> = {
  "cross-sectional-investigation": ["highlighted_entities"],
  "event-transaction-investigation": ["notable_events", "priority_interventions"],
  "generic-time-series-investigation": ["leading_signals"],
};

const CAUSAL_OVERCLAIM = /\b(causes?|caused|causing|proves?|proving|confirms?|guarantees?)\b/i;

function reject(reasonCode: string, reason: string): ActionPolicyResult {
  return { allowed: false, status: "REJECTED", reasonCode, reason };
}
function approve(): ActionPolicyResult {
  return { allowed: true, status: "POLICY_APPROVED", reasonCode: "OK", reason: "All deterministic policy checks passed." };
}

/**
 * Deterministic gate — no LLM call happens here, and none of its inputs are LLM-authored except
 * `proposal.reason`'s free text, which is checked and never trusted. Eligibility depends only on
 * `validationStatus` and the artifact's own content (`knownEvidenceIds`), never on whether the
 * investigation that produced this artifact ran LIVE_AGENT or FALLBACK — a FALLBACK-sourced artifact that
 * is VALIDATED is exactly as eligible as a LIVE_AGENT one (see `proposeAction.ts`'s tests for why this is
 * already true of the underlying validators, not a new relaxation introduced here).
 */
export function checkActionPolicy(input: {
  proposal: ActionProposal;
  validationStatus: "VALIDATED" | "BLOCKED";
  knownEvidenceIds: Set<string>;
  alreadyExecuted: boolean;
  timeSeries?: { workflowId: string; validatedArtifactHash: string; artifactHash: string; targetIds: string[] };
  artifact?: { workflowId: string; expectedWorkflowId: string; target: string; validatedArtifactHash: string; artifactHash: string; targetIds: string[] };
}): ActionPolicyResult {
  const { proposal, validationStatus, knownEvidenceIds, alreadyExecuted } = input;

  if (
    typeof proposal.target !== "string" || !proposal.target ||
    typeof proposal.reason !== "string" || !proposal.reason ||
    !Array.isArray(proposal.evidenceRefs)
  ) {
    return reject("SCHEMA_INVALID", "The action proposal does not have the required shape.");
  }
  if (validationStatus !== "VALIDATED") {
    return reject("VALIDATION_NOT_PASSED", "The investigation artifact is not VALIDATED.");
  }
  if (proposal.type !== "EXPORT_DECISION") {
    return reject("ACTION_TYPE_NOT_ALLOWED", `${proposal.type} is not an allowed action type.`);
  }
  if (!ALLOWED_WORKFLOWS.includes(proposal.workflowId)) {
    return reject("WORKFLOW_NOT_ELIGIBLE", `${proposal.workflowId} is not eligible for controlled actions.`);
  }
  if (!ALLOWED_TARGETS[proposal.workflowId].includes(proposal.target)) {
    return reject("INVALID_TARGET", `${proposal.target} is not an allowed target for ${proposal.workflowId}.`);
  }
  if (!proposal.evidenceRefs.every((id) => knownEvidenceIds.has(id))) {
    return reject("INVALID_EVIDENCE_REFERENCE", "One or more cited Evidence references do not exist in the validated artifact.");
  }
  if (input.timeSeries || proposal.workflowId === "generic-time-series-investigation") {
    const context = input.timeSeries;
    if (!context || proposal.workflowId !== context.workflowId || context.workflowId !== "generic-time-series-investigation") return reject("WORKFLOW_MISMATCH", "The proposal must match the validated time-series workflow.");
    if (!context.validatedArtifactHash || context.artifactHash !== context.validatedArtifactHash || proposal.validatedArtifactHash !== context.validatedArtifactHash) return reject("ARTIFACT_HASH_MISMATCH", "The proposal and artifact must match the validated hash.");
    if (!Array.isArray(proposal.targetIds) || JSON.stringify(proposal.targetIds) !== JSON.stringify(context.targetIds)) return reject("INVALID_TARGET_ID", "The proposal must name exactly the deterministic leading-signal targets in order.");
  }
  if (!input.timeSeries && proposal.workflowId !== "generic-time-series-investigation") {
    const context = input.artifact;
    if (!context || context.workflowId !== context.expectedWorkflowId || proposal.workflowId !== context.workflowId) return reject("WORKFLOW_MISMATCH", "The proposal must match the validated artifact's workflow.");
    if (!context.validatedArtifactHash || context.artifactHash !== context.validatedArtifactHash || proposal.validatedArtifactHash !== context.validatedArtifactHash) return reject("ARTIFACT_HASH_MISMATCH", "The actual artifact and proposal must match the validated hash.");
    if (proposal.target !== context.target) return reject("INVALID_TARGET", "The proposal must use the deterministic target for this artifact.");
    if (!Array.isArray(proposal.targetIds) || JSON.stringify(proposal.targetIds) !== JSON.stringify(context.targetIds)) return reject("INVALID_TARGET_ID", "Target IDs must exactly match eligible artifact rows in order.");
  }
  if (CAUSAL_OVERCLAIM.test(proposal.reason)) {
    return reject("CAUSAL_OVERCLAIM_IN_REASON", "The action reason asserts a causal claim the investigation never established.");
  }
  if (alreadyExecuted) {
    return reject("DUPLICATE_EXECUTION", "This exact action has already been executed for this validated artifact in the current session.");
  }
  return approve();
}
