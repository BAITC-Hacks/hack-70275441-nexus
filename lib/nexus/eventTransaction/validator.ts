import type { EvidenceRecord } from "../agentic/types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { containsEventMetric } from "./agents.ts";
import { buildEventTransactionEvidence } from "./evidence.ts";
import { eventTransactionLiveTools, type EventToolContext } from "./liveTools.ts";
import { analyzeEventTransactions, stableHash, stableStringify } from "./tools.ts";
import type { EventTransactionAnalysis, EventTransactionArtifact, EventTransactionValidation } from "./types.ts";

const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);
const unsupportedClaim = (value: unknown) => /\b(?:is|are|committing|caused|causes)\s+(?:fraud|fraudulent|an attack|malicious|a failure)\b/i.test(JSON.stringify(value));

/**
 * The one addition this bounded-runtime change makes to this validator: every on-demand Evidence record
 * (created by a genuine live tool call — `inspect_entity_activity`/`inspect_event_record` with a real
 * agent-chosen ID, or a gated-visibility `summarize_*` reveal) must be independently reproducible by
 * re-running its own recorded tool with its own recorded argument. Same "recompute and diff" principle the
 * rest of this validator already applies to the whole artifact, applied per-record for the on-demand
 * subset. Never touches `EVIDENCE_CONTENT`/`ANALYSIS_ARTIFACT` or any other existing check.
 */
function reproducible(record: EvidenceRecord, dataset: UploadedDataset, analysis: EventTransactionAnalysis): boolean {
  const tool = eventTransactionLiveTools.find((item) => item.name === record.tool);
  if (!tool) return false;
  const context: EventToolContext = { dataset, analysis };
  const id = typeof record.data.requestedId === "string" ? record.data.requestedId : null;
  if (tool.argumentKind === "id" && (id === null || !(tool.validIds?.(context) ?? []).includes(id))) return false;
  if (tool.argumentKind === "none" && id !== null) return false;
  const result = tool.execute(context, id);
  const expectedData = id !== null ? { ...result.data, requestedId: id } : result.data;
  return same(result.summary, record.result) && same(expectedData, record.data) && same(result.variables, record.variables);
}

export function validateEventTransactionArtifact(dataset: UploadedDataset, artifact: EventTransactionArtifact): EventTransactionValidation {
  const recomputed = analyzeEventTransactions(dataset), expectedEvidence = buildEventTransactionEvidence(recomputed);
  const onDemand = artifact.onDemandEvidence ?? [];
  const allEvidence = [...artifact.evidence, ...onDemand];
  const ids = new Set(allEvidence.map((item) => item.id));
  const refs = [...artifact.investigator.evidenceRefs, ...artifact.skeptic.evidenceRefs, ...artifact.analysis.detection.notableEvents.flatMap((item) => item.evidenceRefs), ...artifact.analysis.highlightedEntities.flatMap((item) => item.evidenceRefs), ...artifact.trace.flatMap((item) => item.evidenceRefs ?? [])];
  const checks = [
    { id: "DATASET_FINGERPRINT", passed: artifact.analysis.dataset.version === recomputed.dataset.version, detail: "Dataset fingerprint matches the admitted source." },
    { id: "EVENT_COUNT", passed: artifact.analysis.dataset.eventCount === dataset.rows.length, detail: "Event count matches source rows." },
    { id: "EVENT_IDENTITY", passed: same(artifact.analysis.profile, recomputed.profile), detail: "Event-ID uniqueness, entity counts and timestamp quality match recomputation." },
    { id: "EVENT_TYPE_COUNTS", passed: same(artifact.analysis.eventTypes, recomputed.eventTypes), detail: "Event-type counts match recomputation." },
    { id: "ENTITY_ACTIVITY", passed: same(artifact.analysis.entityActivity, recomputed.entityActivity), detail: "Entity activity counts and source rows match recomputation." },
    { id: "TIMING_AND_BURSTS", passed: same(artifact.analysis.timing, recomputed.timing), detail: "Timing summaries and bursts match the published window rule." },
    { id: "NOTABLE_EVENT_SELECTION", passed: same(artifact.analysis.detection, recomputed.detection), detail: "Rare types, value outliers, repetitions and notable events match recomputation." },
    { id: "CLUSTER_MEMBERSHIP", passed: same(artifact.analysis.clusters, recomputed.clusters), detail: "Every activity cluster and source-row member matches recomputation." },
    { id: "ANALYSIS_ARTIFACT", passed: same(artifact.analysis, recomputed), detail: "The complete deterministic event artifact matches recomputation." },
    { id: "EVIDENCE_CONTENT", passed: same(artifact.evidence, expectedEvidence), detail: "Canonical Evidence content matches recomputation." },
    { id: "EVIDENCE_REFERENCES", passed: ids.size === allEvidence.length && refs.every((id) => ids.has(id)), detail: "Every source event, entity and agent Evidence reference resolves, baseline or on-demand." },
    { id: "ON_DEMAND_EVIDENCE_REPRODUCIBLE", passed: onDemand.every((record) => reproducible(record, dataset, recomputed)), detail: "Every agent-requested (on-demand) Evidence record is independently reproducible from its recorded tool and argument." },
    { id: "AGENT_NUMERICAL_AUTHORITY", passed: !containsEventMetric(artifact.investigator) && !containsEventMetric(artifact.skeptic), detail: "Agent narrative contains no authoritative metrics." },
    { id: "UNSUPPORTED_DOMAIN_CLAIMS", passed: !unsupportedClaim(artifact.investigator) && !unsupportedClaim(artifact.skeptic), detail: "Agent narrative makes no unsupported causal, fraud, security or failure claim." },
    { id: "WORKFLOW_COMPATIBILITY", passed: artifact.workflowId === "event-transaction-investigation" && artifact.technicalTrace.causality === "NOT_ESTABLISHED", detail: "Artifact declares event workflow and no causality." },
  ];
  return { status: checks.every((item) => item.passed) ? "VALIDATED" : "BLOCKED", checks, validatedArtifactHash: stableHash(artifact) };
}
export function publishedEventArtifactMatches(artifact: EventTransactionArtifact, validation: EventTransactionValidation) { return validation.status === "VALIDATED" && stableHash(artifact) === validation.validatedArtifactHash; }
export function assertPublishableEventResult(artifact: EventTransactionArtifact, validation: EventTransactionValidation) { if (!publishedEventArtifactMatches(artifact, validation)) throw new Error("Event/transaction finalization blocked: artifact differs from validated artifact."); }
