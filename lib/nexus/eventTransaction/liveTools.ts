import type { BoundedTool } from "../agentic/boundedRuntime/runtime.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import type { EventTransactionAnalysis } from "./types.ts";
import { inspectEntityActivity, inspectEventRecord, normalizeEvents } from "./tools.ts";

/**
 * The three `summarize_*` tools reveal a slice of the already-computed `EventTransactionAnalysis` (same
 * "no agent-supplied argument" pattern as cross-sectional's live tools). `inspect_entity_activity` and
 * `inspect_event_record` are genuine on-demand lookups: the agent supplies a real entity/event ID, which
 * is validated against the deterministic ID space before the (already-exported, pure) lookup function
 * runs. None of these can change notable-event membership, repeated-pattern membership, cluster
 * membership, or highlighted-entity selection — that rule engine's output is never exposed as a tool here,
 * only read back via `inspectEntityActivity`'s existing `reasons` field.
 */
export interface EventToolContext {
  dataset: UploadedDataset;
  analysis: EventTransactionAnalysis;
}

export const eventTransactionLiveTools: BoundedTool<EventToolContext>[] = [
  {
    name: "summarize_event_types",
    description: "Reveal the deterministic per-type event counts already computed for this dataset.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: `Обобщено ${context.analysis.eventTypes.length} типов событий с точными исходными количествами.`,
      data: { eventTypes: context.analysis.eventTypes },
      variables: [context.analysis.semantics.eventTypeColumn],
    }),
  },
  {
    name: "summarize_entity_activity",
    description: "Reveal the deterministic per-entity activity summary already computed for this dataset.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: `Обобщено ${context.analysis.profile.uniqueEntities} групп активности сущностей по исходным строкам.`,
      data: { entityActivity: context.analysis.entityActivity },
      variables: context.analysis.semantics.entityColumn ? [context.analysis.semantics.entityColumn] : [],
    }),
  },
  {
    name: "summarize_event_timing",
    description: "Reveal the deterministic timing and same-entity burst summary already computed for this dataset.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: `${context.analysis.timing.bursts.length} скоплений одной сущности соответствуют опубликованному правилу пяти минут.`,
      data: { timing: context.analysis.timing },
      variables: [context.analysis.semantics.timestampColumn],
    }),
  },
  {
    name: "inspect_entity_activity",
    description: "Look up the full deterministic activity record for one specific entity ID.",
    allowedAgents: ["INVESTIGATOR", "SKEPTIC"],
    argumentKind: "id",
    validIds: (context) => context.analysis.entityActivity.map((item) => item.entityId),
    execute: (context, id) => {
      const activity = inspectEntityActivity(context.analysis, id!)!;
      return {
        summary: `Сущность ${id}: ${activity.eventCount} событий ${activity.eventTypes.length} типов, из них ${activity.notableEvents.length} детерминированно замеченных событий и ${activity.clusters.length} групп активности.`,
        data: { ...activity },
        variables: [id!],
      };
    },
  },
  {
    name: "inspect_event_record",
    description: "Look up the full deterministic source record for one specific event ID.",
    allowedAgents: ["SKEPTIC"],
    argumentKind: "id",
    validIds: (context) => normalizeEvents(context.dataset).map((item) => item.eventId),
    execute: (context, id) => {
      const record = inspectEventRecord(context.dataset, id!)!;
      return {
        summary: `Событие ${id} зарегистрировано для сущности ${record.entityId} в момент ${record.timestamp}, тип ${record.eventType}.`,
        data: { ...record },
        variables: [id!],
      };
    },
  },
];

export function availableEventTransactionLiveTools(_dataset: UploadedDataset) {
  return eventTransactionLiveTools;
}
