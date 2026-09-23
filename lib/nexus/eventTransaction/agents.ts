import { LLM_REQUEST_TIMEOUT_MS } from "../agentic/llmRequest.ts";
import { validateTargetedAssumption } from "../agentic/callToolAudit.ts";
import type { AgentCallTrace, EvidenceRecord } from "../agentic/types.ts";
import { runBoundedAgent, type BoundedRequestFn, type BoundedToolTraceEntry, type TerminalOutcome } from "../agentic/boundedRuntime/runtime.ts";
import type { NarrativeAgentOutput, SkepticNarrativeOutput } from "../crossSectional/types.ts";
import { availableEventTransactionLiveTools } from "./liveTools.ts";
import type { EventTransactionAnalysis } from "./types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

export const EVENT_AGENT_TIMEOUT_MS = LLM_REQUEST_TIMEOUT_MS;
export const EVENT_AGENT_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";
export const EVENT_INVESTIGATOR_BUDGETS = { maxTurns: 4, maxToolCalls: 3, timeoutMs: EVENT_AGENT_TIMEOUT_MS };
export const EVENT_SKEPTIC_BUDGETS = { maxTurns: 3, maxToolCalls: 2, timeoutMs: EVENT_AGENT_TIMEOUT_MS };
/** The provenance label set for `selectedTool` — unchanged from before live tool-calling existed. */
const tools = ["summarize_event_types", "summarize_entity_activity", "summarize_event_timing", "detect_notable_events", "detect_repeated_patterns", "correlate_related_events", "inspect_entity_activity", "inspect_event_record"];
const ids = (evidence: EvidenceRecord[]) => evidence.map((item) => item.id);

export function containsEventMetric(value: unknown): boolean {
  const text = value && typeof value === "object" ? Object.values(value as Record<string, unknown>).filter((item) => typeof item === "string").join(" ").replace(/E-\d+/g, "") : "";
  return /\d|%|probability|score\s*(?:of|is|=)/i.test(text);
}
const refsValid = (refs: string[], evidence: EvidenceRecord[]) => refs.length > 0 && refs.every((id) => evidence.some((item) => item.id === id));
/**
 * `hypothesis`/`challenge`/`alternativeExplanation` here are the fallback that reaches the Result page
 * directly (no LLM call failed silently into English) — they must stay Russian for the same reason the
 * live LLM output must (see the `system` instructions below).
 */
const fallbackInvestigator = (evidence: EvidenceRecord[]): NarrativeAgentOutput & { source: "FALLBACK" } => ({ source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "Часть активности сущностей заслуживает проверки согласно опубликованным детерминированным правилам событий.", alternativeExplanation: "Наблюдаемую концентрацию может объяснять безобидная пакетная обработка, повторы, дублирование при сборе данных или неполные идентификаторы.", rationale: "Интерпретация ограничена детерминированным Evidence и не присваивает отраслевого смысла.", evidenceRefs: ids(evidence) });
const fallbackSkeptic = (evidence: EvidenceRecord[]): SkepticNarrativeOutput & { source: "FALLBACK" } => ({ source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Артефакты сбора данных, дублирование, отсутствующие идентификаторы и ограниченная база наблюдений могут представить обычную активность как необычную; причинность и отраслевой смысл не установлены.", alternativeExplanation: "Обычная автоматизация, повторы, пакетная обработка или неполное логирование остаются вероятными объяснениями.", evidenceRefs: ids(evidence) });

const validInvestigator = (value: unknown): value is NarrativeAgentOutput => { const item = value as Partial<NarrativeAgentOutput> | null; return Boolean(item && tools.includes(item.selectedTool ?? "") && typeof item.hypothesis === "string" && typeof item.alternativeExplanation === "string" && typeof item.rationale === "string" && Array.isArray(item.evidenceRefs)); };
const validSkeptic = (value: unknown): value is SkepticNarrativeOutput => { const item = value as Partial<SkepticNarrativeOutput> | null; return Boolean(item && tools.includes(item.selectedTool ?? "") && ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"].includes(item.status ?? "") && typeof item.challenge === "string" && typeof item.alternativeExplanation === "string" && Array.isArray(item.evidenceRefs)); };
/** Strips the turn-protocol-only `action`/`tool`/`id` fields — an on-demand `id` like "EV-008" would otherwise false-positive the digit guard, and these fields have no business in the public narrative output. */
function toNarrativeOutput(raw: NarrativeAgentOutput): NarrativeAgentOutput { return { selectedTool: raw.selectedTool, hypothesis: raw.hypothesis, alternativeExplanation: raw.alternativeExplanation, rationale: raw.rationale, evidenceRefs: raw.evidenceRefs }; }
function toSkepticOutput(raw: SkepticNarrativeOutput): SkepticNarrativeOutput { return { selectedTool: raw.selectedTool, status: raw.status, challenge: raw.challenge, alternativeExplanation: raw.alternativeExplanation, evidenceRefs: raw.evidenceRefs }; }

function investigatorTurnSchema(liveToolNames: string[], evidenceIds: string[], finalTurn: boolean) {
  return { type: "object", additionalProperties: false, required: ["action", "tool", "id", "selectedTool", "hypothesis", "alternativeExplanation", "rationale", "evidenceRefs"], properties: { action: { type: "string", enum: finalTurn ? ["FORM_HYPOTHESIS"] : ["CALL_TOOL", "FORM_HYPOTHESIS"] }, tool: { type: "string", enum: [...liveToolNames, "NONE"] }, id: { type: "string" }, selectedTool: { type: "string", enum: tools }, hypothesis: { type: "string" }, alternativeExplanation: { type: "string" }, rationale: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string", enum: evidenceIds } } } };
}
function skepticTurnSchema(liveToolNames: string[], evidenceIds: string[], finalTurn: boolean) {
  return { type: "object", additionalProperties: false, required: ["targetedAssumption", "action", "tool", "id", "selectedTool", "status", "challenge", "alternativeExplanation", "evidenceRefs"], properties: { targetedAssumption: { type: "string" }, action: { type: "string", enum: finalTurn ? ["FINAL_VERDICT"] : ["CALL_TOOL", "FINAL_VERDICT"] }, tool: { type: "string", enum: [...liveToolNames, "NONE"] }, id: { type: "string" }, selectedTool: { type: "string", enum: tools }, status: { type: "string", enum: ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"] }, challenge: { type: "string" }, alternativeExplanation: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string", enum: evidenceIds } } } };
}

export type EventAgentRuns = {
  investigator: NarrativeAgentOutput & { source: "LLM" | "FALLBACK" };
  skeptic: SkepticNarrativeOutput & { source: "LLM" | "FALLBACK" };
  llmCalls: number;
  agentCalls: AgentCallTrace[];
  /** Evidence created by real live tool calls during this run — empty/absent when nothing was called. Optional for the same reason as the cross-sectional twin: existing hand-written `agentRunner` test stubs predate live tool-calling. */
  onDemandEvidence?: EvidenceRecord[];
  toolTrace?: BoundedToolTraceEntry[];
};
/**
 * `dataset` is optional and folded into the existing options object (rather than added as a new
 * positional parameter) specifically so the pre-existing direct-call convention
 * `runEventAgents(analysis, evidence, objective, options)` used throughout `eventTransaction.test.ts` and
 * `transactionJournal.test.ts` keeps working unchanged. It is only actually needed by the
 * `inspect_event_record` live tool (which looks up a raw source row by event ID); every other live tool
 * only needs the already-computed `analysis`.
 */
export type EventAgentOptions = { request?: BoundedRequestFn; model?: string; timeoutMs?: number; now?: () => Date; dataset?: UploadedDataset };

export async function runEventAgents(analysis: EventTransactionAnalysis, evidence: EvidenceRecord[], objective?: string, options: EventAgentOptions = {}): Promise<EventAgentRuns> {
  const model = options.model || EVENT_AGENT_MODEL;
  const now = options.now ?? (() => new Date());
  const context = { dataset: options.dataset ?? ({ name: "", columns: [], rows: [] } as UploadedDataset), analysis };
  const liveTools = availableEventTransactionLiveTools(context.dataset);
  const domainInstruction = "";
  const budgets = (role: "INVESTIGATOR" | "SKEPTIC") => ({ ...(role === "INVESTIGATOR" ? EVENT_INVESTIGATOR_BUDGETS : EVENT_SKEPTIC_BUDGETS), timeoutMs: options.timeoutMs ?? EVENT_AGENT_TIMEOUT_MS });

  if (!options.request && !process.env.OPENAI_API_KEY) {
    const at = now();
    const missing = (role: "INVESTIGATOR" | "SKEPTIC"): AgentCallTrace => ({ agentRole: role, model, startedAt: at.toISOString(), completedAt: at.toISOString(), durationMs: 0, outcome: "FALLBACK", toolCalls: 0, retryCount: 0, errorClass: null, errorCode: null, fallbackReason: "MISSING_API_KEY" });
    return { investigator: fallbackInvestigator(evidence), skeptic: fallbackSkeptic(evidence), llmCalls: 0, agentCalls: [missing("INVESTIGATOR"), missing("SKEPTIC")], onDemandEvidence: [], toolTrace: [] };
  }

  // The runtime builds payload before schema on each turn. Snapshot that exact exposed set,
  // including only on-demand Evidence that has already been produced by actual tool execution.
  let exposedEvidenceIds = ids(evidence);
  let finalTurn = false;
  const sharedPayload = (evidenceForTurn: EvidenceRecord[], terminalTurn: boolean, role: "INVESTIGATOR" | "SKEPTIC", initialEvidenceCount: number) => {
    const generatedEvidence = evidenceForTurn.slice(initialEvidenceCount);
    finalTurn = terminalTurn;
    exposedEvidenceIds = ids(evidenceForTurn);
    return {
    toolsAlreadyCalledByThisAgent: generatedEvidence.map(item => ({ tool: item.tool, id: typeof item.data.requestedId === "string" ? item.data.requestedId : null, evidenceId: item.id })),
    evidenceGeneratedByThisAgent: generatedEvidence.map(item => ({ id: item.id, tool: item.tool, result: item.result, variables: item.variables, data: item.data })),
    remainingToolCallBudget: Math.max(0, budgets(role).maxToolCalls - generatedEvidence.length),
    toolDecisionContract: "Do NOT repeat an identical tool + argument call from toolsAlreadyCalledByThisAgent. Inspect the Evidence already obtained. If more Evidence is genuinely needed, choose a DIFFERENT useful tool or a different valid argument for an ID lookup. If current Evidence is sufficient, FINISH now. Never call another tool merely to consume the budget. Budget and call history are control metadata: never quote their numbers in narrative fields. Each agent has its own call history; Skeptic must choose an independent counter-check of a specific Investigator assumption.",
    allowedEvidenceIds: exposedEvidenceIds,
    evidenceContract: "Copy evidenceRefs exactly from allowedEvidenceIds. Baseline Evidence is already available. Never guess or predict an Evidence ID. CALL_TOOL requests may use an empty evidenceRefs array; the requested tool has not executed yet. Only after its result appears in the next prompt may you cite its assigned ID. Terminal answers must cite at least one available Evidence ID.",
    objective: objective?.trim() || "Investigate the admitted event/transaction table.",
    semantics: analysis.semantics,
    notableContext: { hasRareTypes: analysis.detection.rareEventTypes.length > 0, hasBursts: analysis.timing.bursts.length > 0, hasRepeatedPatterns: analysis.detection.repeatedPatterns.length > 0, hasValueOutliers: analysis.detection.valueOutlierEventIds.length > 0, hasHighlightedEntities: analysis.highlightedEntities.length > 0 },
    evidence: evidenceForTurn.map((item) => ({ id: item.id, tool: item.tool, variables: item.variables })),
    // `inspect_entity_activity`/`inspect_event_record` take a real agent-chosen ID, validated deterministically
    // against these exact sets before execution — without listing them the model has no way to pick a valid one.
    availableEntityIds: analysis.entityActivity.slice(0, 25).map((item) => item.entityId),
    availableEventIds: analysis.detection.notableEvents.slice(0, 25).map((item) => item.eventId),
    };
  };
  const instruction = domainInstruction + " Select a capability and return narrative fields with valid Evidence IDs only. If the chosen tool is inspect_entity_activity or inspect_event_record, id MUST be one of the exact strings in availableEntityIds/availableEventIds; for every other tool, id MUST be exactly \"NONE\". Use no digits or percent signs outside evidenceRefs/id. Do not output counts, frequencies, values, durations, rankings, windows, scores, thresholds or probabilities. Do not label activity as fraud, attack or failure. Do not reveal hidden reasoning.";

  const investigatorOutcome = await runBoundedAgent<typeof context, NarrativeAgentOutput>({
    role: "INVESTIGATOR", model, system: "You are the NEXUS Investigator. Inspect available Evidence and choose additional unique bounded event checks only when useful and form a neutral candidate interpretation from Evidence IDs. Never calculate metrics or invent domain meaning. Narrative fields must contain no digits or percent signs, including budgets, counts and durations. Copy Evidence IDs only into evidenceRefs; do not restate numerical tool results. Write all user-facing narrative fields in Russian.",
    tools: liveTools, context, evidence, budgets: budgets("INVESTIGATOR"), schemaName: "event_investigator", buildSchema: names => investigatorTurnSchema(names, exposedEvidenceIds, finalTurn),
    buildPayload: (turn, evidenceForTurn) => ({ ...sharedPayload(evidenceForTurn, turn >= budgets("INVESTIGATOR").maxTurns - 1, "INVESTIGATOR", evidence.length), availableCapabilities: tools, instruction: turn < budgets("INVESTIGATOR").maxTurns - 1 ? `Do not repeat any identical tool + argument call in your history. Never consume budget for its own sake. Call a DIFFERENT useful deterministic tool only if current Evidence is insufficient; otherwise finish now with FORM_HYPOTHESIS. ${instruction}` : `Return FORM_HYPOTHESIS now using only valid Evidence IDs. Do not call another tool. ${instruction}` }),
    validateTerminal: (raw, evidenceAtEnd): TerminalOutcome<NarrativeAgentOutput> => {
      if (raw.action === "CALL_TOOL") return { ok: false, reason: "TERMINAL_TURN_REQUIRED" };
      if (!validInvestigator(raw)) return { ok: false, reason: "SCHEMA_VALIDATION_FAILURE" };
      const narrative = toNarrativeOutput(raw);
      if (containsEventMetric(narrative)) return { ok: false, reason: "AUTHORITATIVE_METRIC_REJECTED" };
      if (!refsValid(narrative.evidenceRefs, evidenceAtEnd)) return { ok: false, reason: "INVALID_EVIDENCE_REFERENCE" };
      return { ok: true, terminal: narrative };
    },
    request: options.request, now,
  });

  if (investigatorOutcome.source === "FALLBACK") {
    const completed = now();
    return { investigator: fallbackInvestigator(evidence), skeptic: fallbackSkeptic(evidence), llmCalls: investigatorOutcome.llmCalls, agentCalls: [investigatorOutcome.call, { agentRole: "SKEPTIC", model, startedAt: completed.toISOString(), completedAt: completed.toISOString(), durationMs: 0, outcome: "FALLBACK", toolCalls: 0, retryCount: 0, errorClass: null, errorCode: null, fallbackReason: "INVESTIGATOR_FAILED" }], onDemandEvidence: investigatorOutcome.newEvidence, toolTrace: investigatorOutcome.toolTrace };
  }

  const investigator: NarrativeAgentOutput = investigatorOutcome.terminal!;
  const evidenceAfterInvestigator = [...evidence, ...investigatorOutcome.newEvidence];

  const skepticOutcome = await runBoundedAgent<typeof context, SkepticNarrativeOutput>({
    role: "SKEPTIC", model, system: "You are the NEXUS Skeptic. Challenge benign explanations, duplication, missing IDs, timestamp quality, collection artifacts, baseline size, rarity stability and correlation-versus-causation. Never calculate metrics or invent domain meaning. Narrative fields must contain no digits or percent signs, including budgets, counts and durations. Copy Evidence IDs only into evidenceRefs; do not restate numerical tool results. Write all user-facing narrative fields in Russian.",
    tools: liveTools, context, evidence: evidenceAfterInvestigator, budgets: budgets("SKEPTIC"), schemaName: "event_skeptic", buildSchema: names => skepticTurnSchema(names, exposedEvidenceIds, finalTurn),
    buildPayload: (turn, evidenceForTurn) => ({ ...sharedPayload(evidenceForTurn, turn >= budgets("SKEPTIC").maxTurns - 1, "SKEPTIC", evidenceAfterInvestigator.length), investigator, availableCapabilities: tools, instruction: turn < budgets("SKEPTIC").maxTurns - 1 ? `Do not repeat any identical tool + argument call in your history. Never consume budget for its own sake. Call a DIFFERENT useful counter-check only if current Evidence is insufficient; otherwise finish now with FINAL_VERDICT. For CALL_TOOL provide targetedAssumption: a concise non-empty assumption in the Investigator hypothesis being tested; no numerical claims or hidden reasoning. Use an empty targetedAssumption for terminal answers. ${instruction}` : `Use an empty targetedAssumption. Return FINAL_VERDICT now using only valid Evidence IDs. Do not call another tool. ${instruction}` }),
    validateCallToolMetadata: raw => validateTargetedAssumption(raw, containsEventMetric),
    validateTerminal: (raw, evidenceAtEnd): TerminalOutcome<SkepticNarrativeOutput> => {
      if (raw.action === "CALL_TOOL") return { ok: false, reason: "TERMINAL_TURN_REQUIRED" };
      if (!validSkeptic(raw)) return { ok: false, reason: "SCHEMA_VALIDATION_FAILURE" };
      const narrative = toSkepticOutput(raw);
      if (containsEventMetric(narrative)) return { ok: false, reason: "AUTHORITATIVE_METRIC_REJECTED" };
      if (!refsValid(narrative.evidenceRefs, evidenceAtEnd)) return { ok: false, reason: "INVALID_EVIDENCE_REFERENCE" };
      return { ok: true, terminal: narrative };
    },
    request: options.request, now,
  });

  if (skepticOutcome.source === "FALLBACK") {
    return { investigator: { ...investigator, source: "LLM" }, skeptic: fallbackSkeptic(evidenceAfterInvestigator), llmCalls: investigatorOutcome.llmCalls + skepticOutcome.llmCalls, agentCalls: [investigatorOutcome.call, skepticOutcome.call], onDemandEvidence: [...investigatorOutcome.newEvidence, ...skepticOutcome.newEvidence], toolTrace: [...investigatorOutcome.toolTrace, ...skepticOutcome.toolTrace] };
  }

  return {
    investigator: { ...investigator, source: "LLM" },
    skeptic: { ...(skepticOutcome.terminal as SkepticNarrativeOutput), source: "LLM" },
    llmCalls: investigatorOutcome.llmCalls + skepticOutcome.llmCalls,
    agentCalls: [investigatorOutcome.call, skepticOutcome.call],
    onDemandEvidence: [...investigatorOutcome.newEvidence, ...skepticOutcome.newEvidence],
    toolTrace: [...investigatorOutcome.toolTrace, ...skepticOutcome.toolTrace],
  };
}
