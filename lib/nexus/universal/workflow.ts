import type { WorkflowSpec } from "./contracts.ts";

export const genericTimeSeriesWorkflow: WorkflowSpec = {
  id: "generic-time-series-investigation", shape: "TIME_SERIES", intent: "INVESTIGATE", minimumObservations: 3,
  capabilities: ["inspect_series", "calculate_correlation", "inspect_directional_movement", "build_precursor_chain"].map((id) => ({ id, requires: "TIME_SERIES" })),
  validation: "Admission checks methodological compatibility; existing statistical checks and Skeptic remain unchanged. No universal numerical validator is claimed.",
};

export const crossSectionalWorkflow: WorkflowSpec = {
  id: "cross-sectional-investigation",
  shape: "CROSS_SECTIONAL",
  intent: "INVESTIGATE",
  minimumObservations: 3,
  capabilities: [
    "profile_cross_sectional_dataset",
    "summarize_numeric_columns",
    "summarize_categorical_columns",
    "calculate_cross_sectional_associations",
    "identify_high_risk_entities",
    "compare_delinquency_segment",
    "inspect_target_provenance",
    "validate_cross_sectional_result",
  ].map((id) => ({ id, requires: "CROSS_SECTIONAL" })),
  validation: "Independent deterministic recomputation must pass before the cross-sectional artifact is published.",
};

export const eventTransactionWorkflow: WorkflowSpec = {
  id: "event-transaction-investigation",
  shape: "EVENT_TRANSACTION",
  intent: "INVESTIGATE",
  minimumObservations: 3,
  capabilities: [
    "profile_event_transaction_dataset",
    "summarize_event_types",
    "summarize_entity_activity",
    "summarize_event_timing",
    "detect_notable_events",
    "correlate_related_events",
    "inspect_entity_activity",
    "inspect_event_record",
    "validate_event_transaction_result",
  ].map((id) => ({ id, requires: "EVENT_TRANSACTION" })),
  validation: "Independent deterministic recomputation must pass before the event/transaction artifact is published.",
};
