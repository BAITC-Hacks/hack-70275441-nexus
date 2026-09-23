import OpenAI from "openai";
import type { AgentCallTrace, EvidenceRecord } from "../types.ts";
import { createLlmAudit, LlmRequestFailure } from "../llmRequest.ts";

export type BoundedRole = "INVESTIGATOR" | "SKEPTIC";
export type BoundedToolArgumentKind = "none" | "id";

/**
 * A deterministic, agent-selectable check for the CROSS_SECTIONAL/EVENT_TRANSACTION bounded runtime.
 * This is intentionally NOT the time-series `NexusToolDefinition` — it is a smaller, independent contract
 * scoped to what CS/Event actually need (a name to select, a role allowlist, and either no argument or one
 * agent-supplied ID validated against a deterministic ID set). `execute` must be pure and side-effect free;
 * the runtime and the validator both call it, and the validator's `ON_DEMAND_EVIDENCE_REPRODUCIBLE` check
 * depends on calling it again with the same recorded argument and getting a byte-identical result.
 */
export interface BoundedTool<TContext> {
  name: string;
  description: string;
  allowedAgents: BoundedRole[];
  argumentKind: BoundedToolArgumentKind;
  /** Required (and only consulted) when argumentKind is "id" — the deterministic set of IDs this tool may be called with. */
  validIds?: (context: TContext) => string[];
  execute: (context: TContext, id: string | null) => { summary: string; data: Record<string, unknown>; variables: string[] };
}

export interface BoundedAgentBudgets {
  /** Total model turns for this role's run, including the terminal turn (matches how time-series' own `turn < 2` loop already counts). */
  maxTurns: number;
  /** Soft outer cap on tool calls within those turns — see runtime.ts's own module comment on why this rarely binds. */
  maxToolCalls: number;
  timeoutMs: number;
}

export type BoundedRequestFn = (input: {
  role: BoundedRole;
  model: string;
  system: string;
  payload: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}) => Promise<string>;

async function defaultRequest(input: Parameters<BoundedRequestFn>[0]): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, logLevel: "off" });
  const response = await client.responses.create(
    {
      model: input.model,
      store: false,
      reasoning: { effort: "minimal" },
      max_output_tokens: 2000,
      input: [
        { role: "system", content: input.system },
        { role: "user", content: JSON.stringify(input.payload) },
      ],
      text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } },
    },
    { signal: input.signal },
  );
  return response.output_text;
}

/** Raw turn payload before workflow-owned shape validation — only the fields the runtime itself inspects are typed. */
type RawTurn = { action?: unknown; tool?: unknown; id?: unknown; [key: string]: unknown };

export type TerminalOutcome<TTerminal> = { ok: true; terminal: TTerminal } | { ok: false; reason: string };

export interface BoundedToolTraceEntry {
  role: BoundedRole;
  tool: string;
  id: string | null;
  evidenceId: string;
  metadata?: Record<string, string>;
}

export type CallToolMetadataOutcome = { ok: true; metadata: Record<string, string> } | { ok: false; reason: string };

export interface BoundedAgentOutcome<TTerminal> {
  source: "LLM" | "FALLBACK";
  llmCalls: number;
  toolCalls: number;
  /** null exactly when source is "FALLBACK" — the caller supplies its own fallback narrative, this runtime never invents one. */
  terminal: TTerminal | null;
  /** New Evidence created by real tool execution during this role's run, in call order. Empty on fallback. */
  newEvidence: EvidenceRecord[];
  toolTrace: BoundedToolTraceEntry[];
  call: AgentCallTrace;
}

/**
 * Runs one role's (Investigator or Skeptic) bounded live turn loop for the CROSS_SECTIONAL and
 * EVENT_TRANSACTION workflows: ask the model for the next action, and when it asks for a real tool,
 * validate role permission + argument + duplicate-call before executing it and appending genuine new
 * Evidence — otherwise validate and return the terminal narrative. Time-series' `liveInvestigator.ts` /
 * `liveSkeptic.ts` are untouched and do not use this module; this is deliberately a second, independent,
 * smaller implementation scoped to what CS/Event need (see docs discussion — NOT a shared framework for
 * every future workflow).
 *
 * Every failure path (bad JSON, invalid shape, forbidden tool, bad argument, repeated identical call,
 * exhausted budget, timeout, thrown tool exception) returns the SAME `source: "FALLBACK"` outcome with an
 * explicit `call.fallbackReason` — the caller decides what fallback narrative to show; this runtime never
 * silently degrades or invents one.
 */
export async function runBoundedAgent<TContext, TTerminal>(input: {
  role: BoundedRole;
  model: string;
  system: string;
  tools: BoundedTool<TContext>[];
  context: TContext;
  evidence: EvidenceRecord[];
  budgets: BoundedAgentBudgets;
  buildSchema: (toolNames: string[]) => Record<string, unknown>;
  buildPayload: (turnIndex: number, evidence: EvidenceRecord[]) => unknown;
  schemaName: string;
  /** Workflow-owned: shape validation, numeric-authority guard, evidence-reference validation — in that order, matching existing behavior. */
  validateTerminal: (raw: Record<string, unknown>, evidence: EvidenceRecord[]) => TerminalOutcome<TTerminal>;
  /** Workflow-owned audit text only; never passed to tools or inserted into Evidence. */
  validateCallToolMetadata?: (raw: Record<string, unknown>) => CallToolMetadataOutcome;
  request?: BoundedRequestFn;
  now?: () => Date;
}): Promise<BoundedAgentOutcome<TTerminal>> {
  const now = input.now ?? (() => new Date());
  const request = input.request ?? defaultRequest;
  const audit = createLlmAudit(input.role);
  const started = now();
  const roleTools = input.tools.filter((tool) => tool.allowedAgents.includes(input.role));
  const toolNames = roleTools.map((tool) => tool.name);

  const fail = (
    outcome: AgentCallTrace["outcome"],
    fallbackReason: string,
    llmCalls: number,
    toolCalls: number,
    newEvidence: EvidenceRecord[],
    toolTrace: BoundedToolTraceEntry[],
    errorClass: string | null = null,
    errorCode: string | null = null,
  ): BoundedAgentOutcome<TTerminal> => {
    const completed = now();
    return {
      source: "FALLBACK",
      llmCalls,
      toolCalls,
      terminal: null,
      newEvidence,
      toolTrace,
      call: {
        agentRole: input.role,
        model: input.model,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        outcome,
        toolCalls,
        retryCount: audit.steps.reduce((sum, step) => sum + step.attempts - 1, 0),
        errorClass: errorClass ? "RuntimeError" : null,
        errorCode: errorCode && /^\d{3}$/.test(errorCode) ? errorCode : null,
        fallbackReason,
        runtime: audit.finish(fallbackReason, ["TOOL_EXECUTION_FAILED", "AUTHORITATIVE_METRIC_REJECTED", "INVALID_EVIDENCE_REFERENCE", "INVALID_TOOL_CALL", "DUPLICATE_TOOL_CALL", "TOOL_CALL_BUDGET_EXCEEDED", "TERMINAL_TURN_REQUIRED"].includes(fallbackReason) ? "MODEL_ERROR" : undefined),
      },
    };
  };

  if (!input.request && !process.env.OPENAI_API_KEY) {
    return fail("FALLBACK", "MISSING_API_KEY", 0, 0, [], []);
  }

  let evidence = [...input.evidence];
  const newEvidence: EvidenceRecord[] = [];
  const toolTrace: BoundedToolTraceEntry[] = [];
  const seenCalls = new Set<string>();
  let llmCalls = 0;
  let toolCalls = 0;

  for (let turn = 0; turn < input.budgets.maxTurns; turn += 1) {
    let raw: RawTurn;
    try {
      llmCalls += 1;
      const payload = input.buildPayload(turn, evidence);
      const schema = input.buildSchema(toolNames);
      const text = await audit.request(signal => request({
        role: input.role,
        model: input.model,
        system: input.system,
        payload,
        schemaName: input.schemaName,
        schema,
        signal,
      }), input.budgets.timeoutMs);
      try {
        raw = JSON.parse(text) as RawTurn;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("SCHEMA_ERROR", "SCHEMA_VALIDATION_FAILURE", llmCalls, toolCalls, newEvidence, toolTrace);
      } catch (error) {
        return fail("SCHEMA_ERROR", "JSON_PARSE_FAILURE", llmCalls, toolCalls, newEvidence, toolTrace, (error as Error).name);
      }
    } catch (error) {
      const category = error instanceof LlmRequestFailure ? error.metadata.errorCategory! : "UNKNOWN_ERROR";
      const status = error instanceof LlmRequestFailure ? error.metadata.attemptTrace.at(-1)?.httpStatus : undefined;
      return fail(category === "TIMEOUT" ? "TIMEOUT" : "API_ERROR", category, llmCalls, toolCalls, newEvidence, toolTrace, "LlmRequestFailure", status === undefined ? null : String(status));
    }

    const action = typeof raw.action === "string" ? raw.action : "";
    const isLastTurn = turn === input.budgets.maxTurns - 1;
    const wantsToolCall = action === "CALL_TOOL" && !isLastTurn;

    if (!wantsToolCall) {
      let outcome: TerminalOutcome<TTerminal>;
      try { outcome = input.validateTerminal(raw, evidence); }
      catch { return fail("SCHEMA_ERROR", "SCHEMA_VALIDATION_FAILURE", llmCalls, toolCalls, newEvidence, toolTrace); }
      if (!outcome.ok) return fail("SCHEMA_ERROR", outcome.reason, llmCalls, toolCalls, newEvidence, toolTrace);
      const completed = now();
      return {
        source: "LLM",
        llmCalls,
        toolCalls,
        terminal: outcome.terminal,
        newEvidence,
        toolTrace,
        call: {
          agentRole: input.role,
          model: input.model,
          startedAt: started.toISOString(),
          completedAt: completed.toISOString(),
          durationMs: Math.max(0, completed.getTime() - started.getTime()),
          outcome: "LIVE_AGENT",
          toolCalls,
          retryCount: audit.steps.reduce((sum, step) => sum + step.attempts - 1, 0),
          errorClass: null,
          errorCode: null,
          fallbackReason: null,
          runtime: audit.finish(),
        },
      };
    }

    const toolName = typeof raw.tool === "string" ? raw.tool : "NONE";
    const id = typeof raw.id === "string" && raw.id !== "NONE" ? raw.id : null;
    const callKey = `${toolName}:${id ?? "NONE"}`;
    const tool = roleTools.find((item) => item.name === toolName);
    const argumentValid = tool !== undefined && (tool.argumentKind === "none" ? id === null : id !== null && (tool.validIds?.(input.context) ?? []).includes(id));

    if (!argumentValid) return fail("SCHEMA_ERROR", "INVALID_TOOL_CALL", llmCalls, toolCalls, newEvidence, toolTrace);
    if (seenCalls.has(callKey)) return fail("SCHEMA_ERROR", "DUPLICATE_TOOL_CALL", llmCalls, toolCalls, newEvidence, toolTrace);
    if (toolCalls >= input.budgets.maxToolCalls) return fail("SCHEMA_ERROR", "TOOL_CALL_BUDGET_EXCEEDED", llmCalls, toolCalls, newEvidence, toolTrace);
    let metadata: Record<string, string> | undefined;
    if (input.validateCallToolMetadata) {
      try {
        const outcome = input.validateCallToolMetadata(structuredClone(raw));
        if (!outcome.ok) return fail("SCHEMA_ERROR", outcome.reason, llmCalls, toolCalls, newEvidence, toolTrace);
        if (!outcome.metadata || Object.values(outcome.metadata).some(value => typeof value !== "string")) return fail("SCHEMA_ERROR", "INVALID_TOOL_METADATA", llmCalls, toolCalls, newEvidence, toolTrace);
        metadata = Object.fromEntries(Object.entries(outcome.metadata));
      } catch (error) {
        return fail("SCHEMA_ERROR", "INVALID_TOOL_METADATA", llmCalls, toolCalls, newEvidence, toolTrace, (error as Error).name);
      }
    }
    seenCalls.add(callKey);

    let record: EvidenceRecord;
    try {
      const result = tool!.execute(input.context, id);
      record = {
        id: `E-${String(evidence.length + 1).padStart(3, "0")}`,
        tool: tool!.name,
        variables: result.variables,
        result: result.summary,
        data: id !== null ? { ...result.data, requestedId: id } : result.data,
        usedBy: [input.role],
      };
    } catch (error) {
      return fail("SCHEMA_ERROR", "TOOL_EXECUTION_FAILED", llmCalls, toolCalls, newEvidence, toolTrace, (error as Error).name);
    }
    evidence = [...evidence, record];
    newEvidence.push(record);
    toolCalls += 1;
    toolTrace.push({ role: input.role, tool: tool!.name, id, evidenceId: record.id, ...(metadata ? { metadata } : {}) });
  }

  return fail("SCHEMA_ERROR", "TURN_BUDGET_EXCEEDED", llmCalls, toolCalls, newEvidence, toolTrace);
}
