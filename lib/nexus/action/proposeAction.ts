import type { CrossSectionalWorkflowResult } from "../crossSectional/types.ts";
import type { EventTransactionWorkflowResult } from "../eventTransaction/types.ts";
import type { ActionProposal, ActionWorkflowId } from "./types.ts";
import type { TimeSeriesArtifact, TimeSeriesValidation } from "../timeSeries/validator.ts";

export type TimeSeriesActionResult = { kind: "TIME_SERIES"; artifact: TimeSeriesArtifact; validation: TimeSeriesValidation };
export type EligibleWorkflowResult = CrossSectionalWorkflowResult | EventTransactionWorkflowResult | TimeSeriesActionResult;

/**
 * A single named target row: an entity or event the deterministic rule engine already flagged, with the
 * Evidence references it already carries. Never invented here — every field is read straight off the
 * already-validated artifact.
 */
export interface ActionTargetRow {
  id: string;
  reasons: string[];
  evidenceRefs: string[];
  leadingSignal?: TimeSeriesArtifact["precursorChain"]["edges"][number];
}

/**
 * The one target resolver per eligible workflow. Exported so `exportDecision.ts` can call the exact same
 * function again during verification ("target IDs exactly match the deterministic target resolver" is only
 * a meaningful check if propose and verify literally share this function, not two independently written
 * copies that could silently drift).
 */
export function resolveTargetRows(result: EligibleWorkflowResult): ActionTargetRow[] {
  if (result.kind === "TIME_SERIES") {
    return result.artifact.precursorChain.edges.map(edge => ({
      id: `${encodeURIComponent(edge.from)}::${encodeURIComponent(edge.to)}::${edge.lagPeriods}`,
      reasons: ["Observed precursor relationship; causality is not established."],
      evidenceRefs: [], leadingSignal: edge,
    }));
  }
  if (result.kind === "CROSS_SECTIONAL") {
    return result.artifact.analysis.highRisk.entities.map((entity) => ({ id: entity.entityId, reasons: entity.reasons, evidenceRefs: entity.evidenceRefs }));
  }
  return result.artifact.analysis.detection.notableEvents.map((event) => ({ id: event.eventId, reasons: event.reasons, evidenceRefs: event.evidenceRefs }));
}

export function targetNameFor(workflowId: ActionWorkflowId): string {
  if (workflowId === "generic-time-series-investigation") return "leading_signals";
  return workflowId === "cross-sectional-investigation" ? "highlighted_entities" : "notable_events";
}

/**
 * Deterministic proposal — no OpenAI/LLM call. There is exactly one allowed action in this MVP, so a model
 * call here would add latency and a new failure surface without adding a meaningful decision: the agentic
 * reasoning already happened upstream (Investigator → tool execution → Evidence → Skeptic → Validator).
 * EXPORT_DECISION is the controlled, deterministic consequence of that already-validated result, not a new
 * inference. A future multi-action MVP could let an agent choose among an allowlist here; this one does not.
 */
export function proposeExportDecision(result: EligibleWorkflowResult): ActionProposal {
  const workflowId = result.artifact.workflowId as ActionWorkflowId;
  const rows = resolveTargetRows(result);
  if (result.kind === "TIME_SERIES") {
    return { type: "EXPORT_DECISION", workflowId, target: "leading_signals", reason: "Export observed leading-signal relationships for operator follow-up; causality is not established.", evidenceRefs: [], source: "DETERMINISTIC", validatedArtifactHash: result.validation.validatedArtifactHash, targetIds: rows.map(row => row.id) };
  }
  const evidenceRefs = [...new Set(rows.flatMap((row) => row.evidenceRefs))];
  const reason =
    result.kind === "CROSS_SECTIONAL"
      ? `Export the ${rows.length} ${rows.length === 1 ? "entity" : "entities"} that meet the validated high-risk selection rule, with their supporting Evidence references.`
      : `Export the ${rows.length} source ${rows.length === 1 ? "event" : "events"} that matched at least one validated deterministic attention rule, with their supporting Evidence references.`;
  return { type: "EXPORT_DECISION", workflowId, target: targetNameFor(workflowId), reason, evidenceRefs, source: "DETERMINISTIC", validatedArtifactHash: result.validation.validatedArtifactHash, targetIds: rows.map(row => row.id) };
}
