import type { AgentCallTrace, EvidenceRecord, TraceEvent } from "../agentic/types.ts";
import type { NarrativeAgentOutput, SkepticNarrativeOutput, ValidationCheck } from "../crossSectional/types.ts";

export type EventSemantics = { eventIdColumn: string | null; timestampColumn: string; entityColumn: string | null; eventTypeColumn: string; valueColumn: string | null };
export type NormalizedEvent = { sourceRow: number; eventId: string; entityId: string; timestamp: string; timeMs: number; eventType: string; value: number | null };
export type EventTypeSummary = { eventType: string; count: number; share: number };
export type EntityActivity = { entityId: string; eventCount: number; sourceRows: number[]; firstTimestamp: string; lastTimestamp: string; timeSpanMs: number; eventTypes: string[] };
export type EventGroup = { id: string; entityId: string; eventIds: string[]; sourceRows: number[]; eventTypes: string[]; startTimestamp: string; endTimestamp: string; durationMs: number };
export type RepeatedPattern = EventGroup & { signature: string; count: number };
export type NotableEvent = { eventId: string; sourceRow: number; entityId: string; timestamp: string; eventType: string; value: number | null; reasons: string[]; evidenceRefs: string[] };
export type HighlightedEntity = EntityActivity & { reasons: string[]; evidenceRefs: string[] };
export type EventTransactionAnalysis = {
  dataset: { name: string; version: string; eventCount: number };
  semantics: EventSemantics;
  profile: { uniqueEventIds: number; duplicateEventIds: number; uniqueEntities: number; invalidTimestampCount: number; earliestTimestamp: string; latestTimestamp: string };
  eventTypes: EventTypeSummary[];
  entityActivity: EntityActivity[];
  timing: { validTimestampCount: number; medianGapMs: number | null; burstWindowMs: 300000; bursts: EventGroup[] };
  detection: { rareTypeMaximumCount: number; rareEventTypes: string[]; valueRule: "IQR_1_5" | "UNAVAILABLE"; valueBounds: { lower: number; upper: number } | null; valueOutlierEventIds: string[]; repeatedWindowMs: 300000; repeatedPatterns: RepeatedPattern[]; notableEvents: NotableEvent[] };
  clusters: EventGroup[];
  highlightedEntities: HighlightedEntity[];
  limitations: string[];
};
/** `onDemandEvidence`: Evidence the live Investigator/Skeptic created themselves by genuinely calling a bounded tool — kept separate from the fixed `evidence` baseline so the pre-existing validator checks and artifact hashing never have to change shape. Empty when no live tool call happened this run. */
export type EventTransactionArtifact = { workflowId: "event-transaction-investigation"; analysis: EventTransactionAnalysis; observerFindings: string[]; investigator: NarrativeAgentOutput & { source: "LLM" | "FALLBACK" }; skeptic: SkepticNarrativeOutput & { source: "LLM" | "FALLBACK" }; evidence: EvidenceRecord[]; onDemandEvidence: EvidenceRecord[]; trace: TraceEvent[]; technicalTrace: { toolCalls: number; llmCalls: number; bounded: true; causality: "NOT_ESTABLISHED"; agentCalls: AgentCallTrace[] } };
export type EventTransactionValidation = { status: "VALIDATED" | "BLOCKED"; checks: ValidationCheck[]; validatedArtifactHash: string };
export type EventTransactionWorkflowResult = { kind: "EVENT_TRANSACTION"; artifact: EventTransactionArtifact; validation: EventTransactionValidation };
