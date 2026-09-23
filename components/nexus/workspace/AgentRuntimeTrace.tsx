import type { AgentCallTrace } from "@/lib/nexus/agentic/types";
import type { LlmRuntimeMetadata } from "@/lib/nexus/agentic/llmRequest";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export const DELAYED_AGENT_MESSAGE = "AI-агент отвечает дольше обычного. NEXUS сохранит рассчитанные данные и автоматически перейдёт в резервный режим, если ответ не будет получен вовремя.";
export const runtimeSourceLabel = (source?: string) => source === "FALLBACK" ? "РЕЗЕРВНЫЙ РЕЖИМ" : source === "LLM" ? "ЖИВОЙ АГЕНТ" : "ДЕТЕРМИНИРОВАННО";
export function runtimeFallbackMessage(category?: string) {
  return category === "TIMEOUT"
    ? "Ответ AI-агента не был получен в установленный срок. Расследование продолжено на основе детерминированных результатов."
    : "AI-агент перешёл в резервный режим. Расследование продолжено на основе детерминированных результатов.";
}

/** Server-measured transport audit, deliberately confined to the technical area. */
export function AgentRuntimeTrace({ calls = [], runtime = [] }: {
  calls?: AgentCallTrace[];
  runtime?: Array<LlmRuntimeMetadata | undefined>;
}) {
  const entries = calls.length ? calls.map(call => ({ role: call.agentRole, audit: call.runtime, call }))
    : runtime.filter((audit): audit is LlmRuntimeMetadata => Boolean(audit)).map(audit => ({ role: audit.agent, audit, call: undefined }));
  return <div className="agent-runtime-audit" aria-label="Agent runtime audit" translate="no">{entries.map(({ role, audit, call }, index) => {
    const completed = audit ? audit.status === "COMPLETED" : call?.outcome === "LIVE_AGENT";
    const status = audit?.status ?? (completed ? "COMPLETED" : "FALLBACK");
    return <article key={`${role}-${index}`}>
      <time>{call?.startedAt.slice(11, 19) ?? "LLM"}</time>
      <strong>{role}</strong>
      <div>
        <dl>
          <div><dt>Status</dt><dd>AI {status}</dd></div>
          <div><dt>AI Steps</dt><dd>{audit?.steps.length ?? "—"}</dd></div>
          <div><dt>Total AI time</dt><dd>{seconds(audit?.latencyMs ?? call?.durationMs ?? 0)}</dd></div>
          <div><dt>Error</dt><dd>{audit?.errorCategory ?? "—"}</dd></div>
        </dl>
        {!completed && <p>{runtimeFallbackMessage(audit?.errorCategory)}</p>}
        {call ? ` · ${call.model} · tools ${call.toolCalls} · retries ${call.retryCount}` : ""}
        {audit?.steps.map((step, stepIndex) => <details key={stepIndex}>
          <summary>Reasoning step {stepIndex + 1} · AI {step.status} · {seconds(step.latencyMs)} · attempts {step.attempts}</summary>
          {step.attemptTrace.map(attempt => <p key={attempt.attempt}>Attempt {attempt.attempt} · {attempt.status} · {seconds(attempt.latencyMs)}{attempt.errorCategory ? ` · ${attempt.errorCategory}` : ""}</p>)}
          <small>Deadline per attempt: {seconds(step.timeoutMs)}. Transport metadata ≠ Evidence.</small>
        </details>)}
      </div>
      <small className={`trace-source trace-${completed ? "llm" : "fallback"}`}>AI {status}</small>
    </article>;
  })}</div>;
}
