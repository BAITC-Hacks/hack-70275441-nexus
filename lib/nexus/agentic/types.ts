import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import type { LlmRuntimeMetadata } from "./llmRequest.ts";

export const MAX_AGENT_STEPS = 12;
export const MAX_TOOL_CALLS = 8;
export const MAX_REVISION_ROUNDS = 1;
export const MAX_LLM_CALLS = 6;

export type AgentName = "ORCHESTRATOR" | "OBSERVER" | "INVESTIGATOR" | "SKEPTIC" | "TOOL" | "ACTION";
/** The three ACTION_* values are used only by the Minimal Controlled Action Layer (`lib/nexus/action/`) — see its own `ActionRecord.trace`, never mixed into `artifact.trace`. */
export type TraceEventType = "INVESTIGATION_STARTED" | "AGENT_STARTED" | "AGENT_DECISION" | "TOOL_CALLED" | "TOOL_RESULT" | "HYPOTHESIS_CREATED" | "CHALLENGE_CREATED" | "HYPOTHESIS_REVISED" | "INVESTIGATION_COMPLETED" | "ACTION_PROPOSED" | "ACTION_EXECUTED" | "ACTION_VERIFIED";
export interface TraceEvent { metadata?: Record<string, string>; timestamp: string; agent: AgentName; event: TraceEventType; summary: string; tool?: string; evidenceRefs?: string[]; source?: "LLM" | "DETERMINISTIC" | "FALLBACK"; }
export interface AgentCallTrace { agentRole: "INVESTIGATOR" | "SKEPTIC"; model: string; startedAt: string; completedAt: string; durationMs: number; outcome: "LIVE_AGENT" | "TIMEOUT" | "API_ERROR" | "SCHEMA_ERROR" | "FALLBACK"; toolCalls: number; retryCount: number; errorClass: string | null; errorCode: string | null; fallbackReason: string | null; runtime?: LlmRuntimeMetadata; }
export interface EvidenceRecord { id: string; tool: string; variables: string[]; result: string; data: Record<string, unknown>; usedBy: string[]; }
export interface AgentAction { action: "CALL_TOOL" | "FORM_HYPOTHESIS" | "CHALLENGE" | "REVISE_HYPOTHESIS" | "COMPLETE"; tool?: string; arguments?: Record<string, string>; reason: string; }
export interface ToolContext { dataset: UploadedDataset; signals: string[]; }
export interface ToolResult { summary: string; data: Record<string, unknown>; variables: string[]; }
export interface ExecutionStats { agentSteps: number; toolCalls: number; llmCalls: number; revisionRounds: number; executionLimitReached: boolean; }
export type InvestigationStage = "DATA_ACQUIRED" | "SIGNALS_DETECTED" | "INVESTIGATOR_SELECTING_CHECK" | "INVESTIGATOR_TOOL_EXECUTING" | "HYPOTHESIS_FORMED" | "SKEPTIC_CHALLENGING" | "SKEPTIC_TOOL_EXECUTING" | "HYPOTHESIS_REVISED" | "VERDICT_READY";
export interface InvestigationProgress { stage: InvestigationStage; source: "LLM" | "DETERMINISTIC" | "FALLBACK"; detail: string; }
export interface InvestigationTimings { profiling: number; observer: number; investigatorLlm: number[]; investigatorTool: number[]; skepticLlm: number[]; skepticTool: number[]; revision?: number; total: number; }
/** One lag tested during the exploratory scan, with its exact two-tailed p-value (null below the inference sample-size floor). `n` is the number of row-index-aligned pairs where BOTH columns had a genuinely numeric value at that lag — never inflated by treating a missing cell as 0. */
export interface LagObservation { lag: number; correlation: number; pValue: number | null; n: number; }
/**
 * One computed lag-correlation edge: `from` tends to move `strongestLag` periods before `to`, at the
 * given Pearson correlation. `allLags` keeps every lag tested (0-3) — the strongest is an exploratory
 * pick from a multi-comparison search, not a value chosen in advance; `significant` reflects that lag's
 * p-value surviving Holm correction across the lags tested for this edge. `ci95`/`n`/`pValue` are null
 * when the paired sample is below the inference floor (INSUFFICIENT_SAMPLE), never a fabricated interval.
 */
export interface PrecursorEdge {
  from: string;
  to: string;
  correlation: number;
  lagPeriods: number;
  n: number;
  ci95: { lower: number; upper: number } | null;
  pValue: number | null;
  significant: boolean;
  allLags: LagObservation[];
  bootstrap: { median: number; ci95: { lower: number; upper: number }; resamples: number; stability: "STABLE" | "MODERATE" | "UNSTABLE" } | null;
}
/** Deterministic, fully computed precursor chain — every field is derived from the active dataset, never a fitted or invented constant. */
export interface PrecursorChain { edges: PrecursorEdge[]; riskIndicator: number; riskLabel: "LOW" | "MEDIUM" | "HIGH"; causality: "NOT_ESTABLISHED"; methodologyNotes: string[]; }
export interface AgenticResult { observerFindings: string[]; hypothesis: { primary: string; alternative: string; supportingEvidence: string[]; limitations: string[]; revised: boolean; }; skepticReview: { status: "SUPPORTED" | "CHALLENGED" | "INCONCLUSIVE"; challenge: string; alternatives: string[]; evidenceRefs: string[]; }; finalAssessment: string; evidence: EvidenceRecord[]; trace: TraceEvent[]; executionStats: ExecutionStats; timings: InvestigationTimings; precursorChain: PrecursorChain; nextSteps: string[]; investigator: { source: "LLM" | "FALLBACK"; toolCalls: number; latencies: number[]; runtime?: LlmRuntimeMetadata; }; skeptic: { source: "LLM" | "FALLBACK"; toolCalls: number; latencies: number[]; runtime?: LlmRuntimeMetadata; }; }
