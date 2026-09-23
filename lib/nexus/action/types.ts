import type { TraceEvent } from "../agentic/types.ts";

/**
 * The Minimal Controlled Action Layer. Exactly one action type exists in this MVP — EXPORT_DECISION — for
 * CROSS_SECTIONAL, EVENT_TRANSACTION and independently validated TIME_SERIES artifacts.
 *
 * This is a second, independent, small contract — it does NOT reuse `EvidenceRecord`. Evidence means "a
 * deterministic analytical finding produced by a tool" (`tool`, `variables`, `data`, `usedBy`); an action
 * record means "a controlled side effect NEXUS performed after validation." Blurring the two would make a
 * judge (or the validator's own EVIDENCE_REFERENCES check) unable to tell an analytical finding from an
 * action byproduct just by looking at an ID. Action IDs use a separate "A-00N" namespace for the same
 * reason — they are never mixed into `artifact.evidence`/`onDemandEvidence`.
 */
export type ActionType = "EXPORT_DECISION";
export type ActionWorkflowId = "cross-sectional-investigation" | "event-transaction-investigation" | "generic-time-series-investigation";
export type ActionStatus = "PROPOSED" | "POLICY_APPROVED" | "REJECTED" | "EXECUTED" | "VERIFIED" | "FAILED";

/**
 * Always `source: "DETERMINISTIC"` in this MVP — see `proposeAction.ts`'s module comment for why no LLM
 * call is made to produce this. `target` names a fixed, known slice of the validated artifact (never a
 * free-form string) so the policy gate can check it against an explicit allowlist.
 */
export interface ActionProposal {
  type: ActionType;
  workflowId: ActionWorkflowId;
  target: string;
  reason: string;
  evidenceRefs: string[];
  source: "DETERMINISTIC";
  /** TIME_SERIES binds its proposal directly to the validated chain and its row IDs. */
  validatedArtifactHash?: string;
  targetIds?: string[];
}

export interface ActionPolicyResult {
  allowed: boolean;
  status: "POLICY_APPROVED" | "REJECTED";
  reasonCode: string;
  reason: string;
}

export interface ActionArtifactFile {
  fileName: string;
  mimeType: string;
  /** Full serialized content, generated in memory. The UI's download buttons only ever serialize this — they never construct it themselves. */
  content: string;
  rowCount: number;
}

export interface ActionExecutionResult {
  status: "EXECUTED" | "FAILED";
  files: ActionArtifactFile[];
  error?: string;
}

export interface ActionVerificationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ActionVerificationResult {
  status: "VERIFIED" | "FAILED";
  checks: ActionVerificationCheck[];
}

export interface ActionRecord {
  id: string;
  proposal: ActionProposal;
  policy: ActionPolicyResult;
  execution: ActionExecutionResult | null;
  verification: ActionVerificationResult | null;
  status: ActionStatus;
  investigationRef: { workflowId: ActionWorkflowId; validatedArtifactHash: string };
  /** Self-contained action trace using the existing TraceEvent structure — never merged into `artifact.trace`, because the artifact's own hash was already computed by the validator before this action ran; appending to it after the fact would silently invalidate `validatedArtifactHash`. */
  trace: TraceEvent[];
  createdAt: string;
}
