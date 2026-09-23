/** Transport audit only: never Evidence, tool input, or business validation. */
export const LLM_REQUEST_TIMEOUT_MS = 15_000;
export const LLM_RETRY_DELAY_MS = 100;
export const LLM_MAX_ATTEMPTS = 2;

export type LlmErrorCategory = "TIMEOUT" | "RATE_LIMIT" | "SERVER_ERROR" | "NETWORK_ERROR" | "INVALID_STRUCTURED_OUTPUT" | "MODEL_ERROR" | "UNKNOWN_ERROR";
export interface LlmAttemptTrace { attempt: number; latencyMs: number; status: "COMPLETED" | "FAILED"; errorCategory?: LlmErrorCategory; httpStatus?: number; }
export interface LlmStepTrace {
  agent: string;
  status: "COMPLETED" | "FALLBACK" | "FAILED";
  attempts: number;
  latencyMs: number;
  timeoutMs: number;
  fallbackReason?: string;
  errorCategory?: LlmErrorCategory;
  attemptTrace: LlmAttemptTrace[];
}
export interface LlmRuntimeMetadata {
  agent: string;
  status: "COMPLETED" | "FALLBACK" | "FAILED";
  attempts: number;
  latencyMs: number;
  fallbackReason?: string;
  errorCategory?: LlmErrorCategory;
  steps: LlmStepTrace[];
}

/** Classify only safe discriminators. Never retain message, body, arbitrary code, or API payload. */
export function classifyLlmError(error: unknown, timedOut = false): LlmErrorCategory {
  const item = error as { status?: unknown; name?: unknown; code?: unknown; constructor?: { name?: unknown } } | null;
  const name = typeof item?.name === "string" ? item.name : "";
  const className = typeof item?.constructor?.name === "string" ? item.constructor.name : "";
  if (timedOut || [name, className].some(value => /^(TimeoutError|AbortError|APIUserAbortError|APIConnectionTimeoutError)$/.test(value))) return "TIMEOUT";
  if (item?.status === 429) return "RATE_LIMIT";
  if (typeof item?.status === "number" && item.status >= 500 && item.status <= 599) return "SERVER_ERROR";
  if ([name, className].some(value => value === "APIConnectionError" || value === "TypeError") || ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE"].includes(String(item?.code))) return "NETWORK_ERROR";
  if (typeof item?.status === "number" && item.status >= 400 && item.status <= 499) return "MODEL_ERROR";
  return "UNKNOWN_ERROR";
}
const retryable = (category: LlmErrorCategory) => ["TIMEOUT", "RATE_LIMIT", "SERVER_ERROR", "NETWORK_ERROR"].includes(category);

export class LlmRequestFailure extends Error {
  readonly metadata: LlmStepTrace;
  constructor(metadata: LlmStepTrace) { super(metadata.errorCategory ?? "UNKNOWN_ERROR"); this.name = "LlmRequestFailure"; this.metadata = metadata; }
}

/** A hard deadline also bounds transports that ignore AbortSignal. Each retry gets a fresh signal. */
export async function requestLlm<T>(input: {
  agent: string;
  request: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<{ value: T; metadata: LlmStepTrace }> {
  const requestedTimeout = input.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1, Math.min(LLM_REQUEST_TIMEOUT_MS, requestedTimeout)) : LLM_REQUEST_TIMEOUT_MS;
  const totalStarted = performance.now();
  const attemptTrace: LlmAttemptTrace[] = [];
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new DOMException("Request deadline exceeded", "TimeoutError")); }, timeoutMs);
      });
      const value = await Promise.race([Promise.resolve().then(() => input.request(controller.signal)), deadline]);
      attemptTrace.push({ attempt, latencyMs: Math.max(0, performance.now() - started), status: "COMPLETED" });
      return { value, metadata: { agent: input.agent, status: "COMPLETED", attempts: attemptTrace.length, latencyMs: Math.max(0, performance.now() - totalStarted), timeoutMs, attemptTrace } };
    } catch (error) {
      const errorCategory = classifyLlmError(error, controller.signal.aborted);
      const status = (error as { status?: unknown } | null)?.status;
      attemptTrace.push({ attempt, latencyMs: Math.max(0, performance.now() - started), status: "FAILED", errorCategory,
        ...(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? { httpStatus: status } : {}) });
      if (!retryable(errorCategory) || attempt === LLM_MAX_ATTEMPTS) throw new LlmRequestFailure({ agent: input.agent, status: "FALLBACK", attempts: attemptTrace.length, latencyMs: Math.max(0, performance.now() - totalStarted), timeoutMs, fallbackReason: errorCategory, errorCategory, attemptTrace });
    } finally { if (timer !== undefined) clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, input.retryDelayMs ?? LLM_RETRY_DELAY_MS));
  }
  throw new Error("Unreachable attempt limit");
}

export function createLlmAudit(agent: string) {
  const steps: LlmStepTrace[] = [];
  return {
    steps,
    async request<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
      try { const result = await requestLlm({ agent, request, timeoutMs }); steps.push(result.metadata); return result.value; }
      catch (error) { if (error instanceof LlmRequestFailure) steps.push(error.metadata); throw error; }
    },
    finish(fallbackReason?: string, category?: LlmErrorCategory): LlmRuntimeMetadata {
      const last = steps.at(-1);
      const errorCategory = category ?? last?.errorCategory;
      if (fallbackReason && last?.status === "COMPLETED") {
        last.status = "FALLBACK"; last.fallbackReason = fallbackReason; last.errorCategory = errorCategory ?? "INVALID_STRUCTURED_OUTPUT";
      }
      return { agent, status: fallbackReason ? "FALLBACK" : "COMPLETED", attempts: steps.reduce((sum, step) => sum + step.attempts, 0), latencyMs: steps.reduce((sum, step) => sum + step.latencyMs, 0), ...(fallbackReason ? { fallbackReason, errorCategory: errorCategory ?? (steps.length ? "INVALID_STRUCTURED_OUTPUT" : "MODEL_ERROR") } : {}), steps: structuredClone(steps) };
    },
  };
}
