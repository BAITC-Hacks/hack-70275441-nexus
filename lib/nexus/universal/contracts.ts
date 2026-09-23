import type { UploadedDataset } from "../ingestion/types.ts";

export type DataShapeTag = "TIME_SERIES" | "CROSS_SECTIONAL" | "EVENT_TRANSACTION" | "AMBIGUOUS_TABULAR";
export type TaskIntent = "ANALYZE" | "INVESTIGATE" | "SCORE";
export type RouteStatus = "PROCEED" | "NEEDS_INPUT" | "REJECTED" | "UNSUPPORTED";
export interface ShapeProfile {
  tag: DataShapeTag;
  support: "CONFIRMED" | "AMBIGUOUS";
  timeColumn?: string;
  measures: string[];
  reasons: string[];
  missingRequirements: string[];
}
export interface RouteDecision {
  status: RouteStatus;
  shape: ShapeProfile;
  intent: TaskIntent | null;
  workflowId?: string;
  reasons: string[];
  missingRequirements: string[];
  compatibilityRuleIds: string[];
}
export interface CapabilityDescriptor { id: string; requires: DataShapeTag; }
export interface WorkflowSpec { id: string; shape: DataShapeTag; intent: TaskIntent; minimumObservations: number; capabilities: CapabilityDescriptor[]; validation: string; }
export interface AdmissionRequest { dataset: UploadedDataset; signals: string[]; taskId?: string; intent?: string; mapping?: { date?: string; target?: string }; }
