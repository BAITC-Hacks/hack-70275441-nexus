import type { LlmRuntimeMetadata } from "./nexus/agentic/llmRequest.ts";

/** TIME_SERIES presentation contracts used by the current investigation workspace. */
export interface InvestigatorRun {
  runtime?: LlmRuntimeMetadata;
  output: { hypothesis: string; alternative_explanation: string; reasoning: string };
  source: "openai" | "fallback";
  fallbackReason?: "missing_api_key" | "timeout" | "api_error" | "invalid_response";
}

export interface ValidatorRun {
  runtime?: LlmRuntimeMetadata;
  output: { alternative_explanations: string[]; challenge: string; validation_reasoning: string; status: "validated" | "challenged" | "inconclusive" };
  source: "openai" | "fallback";
  fallbackReason?: "missing_api_key" | "timeout" | "api_error" | "invalid_response";
}
