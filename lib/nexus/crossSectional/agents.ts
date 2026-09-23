import { LLM_REQUEST_TIMEOUT_MS } from "../agentic/llmRequest.ts";
import { validateTargetedAssumption } from "../agentic/callToolAudit.ts";
import type { AgentCallTrace, EvidenceRecord } from "../agentic/types.ts";
import { runBoundedAgent, type BoundedRequestFn, type BoundedToolTraceEntry, type TerminalOutcome } from "../agentic/boundedRuntime/runtime.ts";
import { crossSectionalLiveTools } from "./liveTools.ts";
import type { CrossSectionalAnalysis, CrossSectionalFixtureMetadata, NarrativeAgentOutput, SkepticNarrativeOutput } from "./types.ts";

export const CROSS_SECTIONAL_AGENT_TIMEOUT_MS = LLM_REQUEST_TIMEOUT_MS;
export const CROSS_SECTIONAL_AGENT_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";
export const CROSS_SECTIONAL_INVESTIGATOR_BUDGETS = { maxTurns: 4, maxToolCalls: 3, timeoutMs: CROSS_SECTIONAL_AGENT_TIMEOUT_MS };
export const CROSS_SECTIONAL_SKEPTIC_BUDGETS = { maxTurns: 3, maxToolCalls: 2, timeoutMs: CROSS_SECTIONAL_AGENT_TIMEOUT_MS };
/** The provenance label set for `selectedTool` — unchanged from before live tool-calling existed; it names which evidence backs the narrative, independent of whether a live tool call happened this run. */
const toolNames = ["summarize_numeric_columns", "summarize_categorical_columns", "calculate_cross_sectional_associations", "identify_high_risk_entities", "compare_delinquency_segment"];
const evidenceIds = (evidence: EvidenceRecord[]) => evidence.map((item) => item.id);

export function containsAuthoritativeMetric(value: unknown): boolean {
  const text = Object.values(value as Record<string, unknown>).filter((item) => typeof item === "string").join(" ").replace(/E-\d+/g, "");
  return /\d|%|\br\s*=|correlation\s+(?:of|is)/i.test(text);
}
function validRefs(refs: string[], evidence: EvidenceRecord[]) { return refs.length > 0 && refs.every((id) => evidence.some((item) => item.id === id)); }
/**
 * `hypothesis`/`challenge`/`alternativeExplanation` here are the fallback that reaches the Result page
 * directly (no LLM call failed silently into English) — they must stay Russian for the same reason the
 * live LLM output must (see the `system` instructions above).
 */
function fallbackInvestigator(evidence: EvidenceRecord[]): NarrativeAgentOutput & { source: "FALLBACK" } {
  return { source: "FALLBACK", selectedTool: "calculate_cross_sectional_associations", hypothesis: "Заданный итоговый показатель сконцентрирован у записей с характерным сочетанием наблюдаемых признаков.", alternativeExplanation: "Наблюдение может объясняться способом построения показателя, смешивающими факторами, эффектами отбора выборки или небольшой подгруппой, а не независимым механизмом риска.", rationale: "Детерминированный артефакт подтверждает только связь, не устанавливая временной порядок или причинность.", evidenceRefs: evidenceIds(evidence) };
}
function fallbackSkeptic(evidence: EvidenceRecord[], metadata?: CrossSectionalFixtureMetadata): SkepticNarrativeOutput & { source: "FALLBACK" } {
  const leakage = metadata?.targetProvenance ? "Подготовленное происхождение показателя говорит о том, что заданный показатель повторно использует часть исследованных признаков, поэтому сильные связи могут быть циркулярными, а не независимым открытием." : "Заданный итоговый показатель может отражать более ранние решения при построении модели; без данных о происхождении утечку и циркулярность нельзя исключить.";
  return { source: "FALLBACK", selectedTool: metadata?.targetProvenance ? "inspect_target_provenance" : "compare_delinquency_segment", status: "CHALLENGED", challenge: `${leakage} Связь в поперечном срезе также не устанавливает причинность.`, alternativeExplanation: "Смешивающие факторы, способ построения показателя, пропуски и размер подгруппы остаются вероятными объяснениями.", evidenceRefs: evidenceIds(evidence) };
}

function investigatorTurnSchema(liveToolNames: string[], exposedEvidenceIds: string[], finalTurn: boolean) {
  return { type: "object", additionalProperties: false, required: ["action", "tool", "id", "selectedTool", "hypothesis", "alternativeExplanation", "rationale", "evidenceRefs"], properties: { action: { type: "string", enum: finalTurn ? ["FORM_HYPOTHESIS"] : ["CALL_TOOL", "FORM_HYPOTHESIS"] }, tool: { type: "string", enum: [...liveToolNames, "NONE"] }, id: { type: "string" }, selectedTool: { type: "string", enum: toolNames }, hypothesis: { type: "string" }, alternativeExplanation: { type: "string" }, rationale: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string", enum: exposedEvidenceIds } } } } as const;
}
function skepticTurnSchema(liveToolNames: string[], exposedEvidenceIds: string[], finalTurn: boolean) {
  return { type: "object", additionalProperties: false, required: ["targetedAssumption", "action", "tool", "id", "selectedTool", "status", "challenge", "alternativeExplanation", "evidenceRefs"], properties: { targetedAssumption: { type: "string" }, action: { type: "string", enum: finalTurn ? ["FINAL_VERDICT"] : ["CALL_TOOL", "FINAL_VERDICT"] }, tool: { type: "string", enum: [...liveToolNames, "NONE"] }, id: { type: "string" }, selectedTool: { type: "string", enum: [...toolNames, "inspect_target_provenance"] }, status: { type: "string", enum: ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"] }, challenge: { type: "string" }, alternativeExplanation: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string", enum: exposedEvidenceIds } } } } as const;
}

function validInvestigator(value: unknown): value is NarrativeAgentOutput {
  const item = value as Partial<NarrativeAgentOutput> | null;
  return Boolean(item && typeof item.selectedTool === "string" && typeof item.hypothesis === "string" && typeof item.alternativeExplanation === "string" && typeof item.rationale === "string" && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === "string"));
}
function validSkeptic(value: unknown): value is SkepticNarrativeOutput {
  const item = value as Partial<SkepticNarrativeOutput> | null;
  return Boolean(item && typeof item.selectedTool === "string" && ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"].includes(item.status ?? "") && typeof item.challenge === "string" && typeof item.alternativeExplanation === "string" && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === "string"));
}
/** Strips the turn-protocol-only `action`/`tool`/`id` fields before anything (numeric-authority checks, the published artifact) sees the narrative — an on-demand tool's `id` (e.g. "CUST-03") would otherwise false-positive the digit guard, and the protocol fields have no business in the public NarrativeAgentOutput/SkepticNarrativeOutput. */
function toNarrativeOutput(raw: NarrativeAgentOutput): NarrativeAgentOutput { return { selectedTool: raw.selectedTool, hypothesis: raw.hypothesis, alternativeExplanation: raw.alternativeExplanation, rationale: raw.rationale, evidenceRefs: raw.evidenceRefs }; }
function toSkepticOutput(raw: SkepticNarrativeOutput): SkepticNarrativeOutput { return { selectedTool: raw.selectedTool, status: raw.status, challenge: raw.challenge, alternativeExplanation: raw.alternativeExplanation, evidenceRefs: raw.evidenceRefs }; }

export type CrossSectionalAgentRuns = {
  investigator: NarrativeAgentOutput & { source: "LLM" | "FALLBACK" };
  skeptic: SkepticNarrativeOutput & { source: "LLM" | "FALLBACK" };
  llmCalls: number;
  agentCalls: AgentCallTrace[];
  /**
   * Evidence created by real live tool calls during this run — empty/absent when nothing was called
   * (fallback, or the model went straight to a terminal answer). Always continues numbering after the
   * baseline `evidence` passed in. Optional so a hand-written `agentRunner` test stub (see
   * `crossSectional.test.ts`'s `fallbackAgents`) that predates live tool-calling still type-checks —
   * `workflow.ts` reads both fields defensively with `?? []`.
   */
  onDemandEvidence?: EvidenceRecord[];
  toolTrace?: BoundedToolTraceEntry[];
};

type RunOptions = { request?: BoundedRequestFn; model?: string; timeoutMs?: number; now?: () => Date };

export async function runCrossSectionalAgents(analysis: CrossSectionalAnalysis, evidence: EvidenceRecord[], metadata?: CrossSectionalFixtureMetadata, objective?: string, options: RunOptions = {}): Promise<CrossSectionalAgentRuns> {
  const model = options.model || CROSS_SECTIONAL_AGENT_MODEL;
  const now = options.now ?? (() => new Date());
  const context = { analysis, metadata };
  const budgets = (role: "INVESTIGATOR" | "SKEPTIC") => ({ ...(role === "INVESTIGATOR" ? CROSS_SECTIONAL_INVESTIGATOR_BUDGETS : CROSS_SECTIONAL_SKEPTIC_BUDGETS), timeoutMs: options.timeoutMs ?? CROSS_SECTIONAL_AGENT_TIMEOUT_MS });

  if (!options.request && !process.env.OPENAI_API_KEY) {
    const timestamp = now();
    const missing = (role: "INVESTIGATOR" | "SKEPTIC"): AgentCallTrace => ({ agentRole: role, model, startedAt: timestamp.toISOString(), completedAt: timestamp.toISOString(), durationMs: 0, outcome: "FALLBACK", toolCalls: 0, retryCount: 0, errorClass: null, errorCode: null, fallbackReason: "MISSING_API_KEY" });
    return { investigator: fallbackInvestigator(evidence), skeptic: fallbackSkeptic(evidence, metadata), llmCalls: 0, agentCalls: [missing("INVESTIGATOR"), missing("SKEPTIC")], onDemandEvidence: [], toolTrace: [] };
  }

  let exposedEvidenceIds = evidenceIds(evidence);
  // Payload is constructed before schema on each runtime turn.
  let finalTurn = false;
  const sharedPayload = (evidenceForTurn: EvidenceRecord[], terminalTurn: boolean, role: "INVESTIGATOR" | "SKEPTIC", initialEvidenceCount: number) => {
    const generatedEvidence = evidenceForTurn.slice(initialEvidenceCount);
    finalTurn = terminalTurn;
    exposedEvidenceIds = evidenceIds(evidenceForTurn);
    return {
    toolsAlreadyCalledByThisAgent: generatedEvidence.map(item => ({ tool: item.tool, id: typeof item.data.requestedId === "string" ? item.data.requestedId : null, evidenceId: item.id })),
    evidenceGeneratedByThisAgent: generatedEvidence.map(item => ({ id: item.id, tool: item.tool, result: item.result, variables: item.variables, data: item.data })),
    remainingToolCallBudget: Math.max(0, budgets(role).maxToolCalls - generatedEvidence.length),
    toolDecisionContract: "Do NOT repeat an identical tool + argument call from toolsAlreadyCalledByThisAgent. Inspect the Evidence already obtained. If more Evidence is genuinely needed, choose a DIFFERENT useful tool or a different valid argument for an ID lookup. If current Evidence is sufficient, FINISH now. Never call another tool merely to consume the budget. Budget and call history are control metadata: never quote their numbers in narrative fields. Each agent has its own call history; Skeptic must choose an independent counter-check of a specific Investigator assumption.",
    allowedEvidenceIds: exposedEvidenceIds,
    evidenceContract: "Copy Evidence IDs exactly from allowedEvidenceIds. Never guess future IDs. CALL_TOOL may cite no Evidence; terminal answers must cite existing Evidence. Newly executed tool results appear in the next prompt.",
    objective: objective?.trim() || "Investigate the admitted cross-sectional entity table.",
    target: { column: analysis.target.column, kind: analysis.target.kind, source: analysis.target.source },
    rankedAssociations: analysis.drivers.slice(0, 5).map((item) => ({ predictor: item.predictor, target: item.target, method: item.method, evidenceRef: "E-004" })),
    highlightedEntitySample: analysis.highRisk.entities.slice(0, 10).map((item) => item.entityId),
    availableSegments: analysis.categoricalSummaries.map((item) => item.column),
    limitations: analysis.limitations,
    evidence: evidenceForTurn.map((item) => ({ id: item.id, tool: item.tool, variables: item.variables, summary: item.result })),
    };
  };

  const investigatorOutcome = await runBoundedAgent<typeof context, NarrativeAgentOutput>({
    role: "INVESTIGATOR", model, system: "You are the NEXUS Investigator. Inspect available Evidence and select additional unique deterministic checks only when useful and form a cautious cross-sectional hypothesis. Never calculate or state a numerical metric. Narrative fields must contain no digits or percent signs, including budgets and call counts. Copy Evidence IDs only into evidenceRefs; do not restate numerical tool results. Write all user-facing narrative fields in Russian.",
    tools: crossSectionalLiveTools, context, evidence, budgets: budgets("INVESTIGATOR"), schemaName: "cross_sectional_investigator", buildSchema: names => investigatorTurnSchema(names, exposedEvidenceIds, finalTurn),
    buildPayload: (turn, evidenceForTurn) => ({ ...sharedPayload(evidenceForTurn, turn >= budgets("INVESTIGATOR").maxTurns - 1, "INVESTIGATOR", evidence.length), instruction: turn < budgets("INVESTIGATOR").maxTurns - 1 ? "Do not repeat any identical tool + argument call in your history. Never consume budget for its own sake. Call a DIFFERENT useful deterministic tool only if current Evidence is insufficient; otherwise finish now with FORM_HYPOTHESIS. Return narrative fields and valid Evidence IDs only. The evidence summaries below already contain numbers, percentages and counts — describe the pattern in plain words and never repeat, restate or paraphrase any digit, percentage, correlation value, threshold, count or probability from them. Association is not causation." : "Return FORM_HYPOTHESIS now using only valid Evidence IDs. Do not call another tool, calculate values, or invent causality. Never repeat any digit, percentage or count from the evidence summaries — describe the pattern in plain words only." }),
    validateTerminal: (raw, evidenceAtEnd): TerminalOutcome<NarrativeAgentOutput> => {
      if (raw.action === "CALL_TOOL") return { ok: false, reason: "TERMINAL_TURN_REQUIRED" };
      if (!validInvestigator(raw)) return { ok: false, reason: "SCHEMA_VALIDATION_FAILURE" };
      const narrative = toNarrativeOutput(raw);
      if (containsAuthoritativeMetric(narrative)) return { ok: false, reason: "AUTHORITATIVE_METRIC_REJECTED" };
      if (!validRefs(narrative.evidenceRefs, evidenceAtEnd)) return { ok: false, reason: "INVALID_EVIDENCE_REFERENCE" };
      return { ok: true, terminal: narrative };
    },
    request: options.request, now,
  });

  if (investigatorOutcome.source === "FALLBACK") {
    const completed = now();
    return { investigator: fallbackInvestigator(evidence), skeptic: fallbackSkeptic(evidence, metadata), llmCalls: investigatorOutcome.llmCalls, agentCalls: [investigatorOutcome.call, { agentRole: "SKEPTIC", model, startedAt: completed.toISOString(), completedAt: completed.toISOString(), durationMs: 0, outcome: "FALLBACK", toolCalls: 0, retryCount: 0, errorClass: null, errorCode: null, fallbackReason: "INVESTIGATOR_FAILED" }], onDemandEvidence: investigatorOutcome.newEvidence, toolTrace: investigatorOutcome.toolTrace };
  }

  const investigator: NarrativeAgentOutput = investigatorOutcome.terminal!;
  const evidenceAfterInvestigator = [...evidence, ...investigatorOutcome.newEvidence];

  const skepticOutcome = await runBoundedAgent<typeof context, SkepticNarrativeOutput>({
    role: "SKEPTIC", model, system: "You are the NEXUS Skeptic. Challenge leakage, circularity, confounding, missingness, subgroup size, supplied-score provenance and correlation-versus-causation. Never calculate or state a numerical metric. Narrative fields must contain no digits or percent signs, including budgets and call counts. Copy Evidence IDs only into evidenceRefs; do not restate numerical tool results. Write all user-facing narrative fields in Russian.",
    tools: crossSectionalLiveTools, context, evidence: evidenceAfterInvestigator, budgets: budgets("SKEPTIC"), schemaName: "cross_sectional_skeptic", buildSchema: names => skepticTurnSchema(names, exposedEvidenceIds, finalTurn),
    buildPayload: (turn, evidenceForTurn) => ({ ...sharedPayload(evidenceForTurn, turn >= budgets("SKEPTIC").maxTurns - 1, "SKEPTIC", evidenceAfterInvestigator.length), investigator, targetProvenance: metadata?.targetProvenance ?? null, instruction: turn < budgets("SKEPTIC").maxTurns - 1 ? "Do not repeat any identical tool + argument call in your history. Never consume budget for its own sake. Call a DIFFERENT useful counter-check only if current Evidence is insufficient; otherwise finish now with FINAL_VERDICT. For CALL_TOOL provide targetedAssumption: a concise non-empty assumption in the Investigator hypothesis being tested; no numerical claims or hidden reasoning. Use an empty targetedAssumption for terminal answers. Never repeat, restate or paraphrase any digit, percentage, correlation value, threshold, count or probability from the evidence summaries — describe the pattern in plain words only." : "Use an empty targetedAssumption. Return FINAL_VERDICT now using only valid Evidence IDs. Do not call another tool or invent numbers. Never repeat any digit, percentage or count from the evidence summaries." }),
    validateCallToolMetadata: raw => validateTargetedAssumption(raw, containsAuthoritativeMetric),
    validateTerminal: (raw, evidenceAtEnd): TerminalOutcome<SkepticNarrativeOutput> => {
      if (raw.action === "CALL_TOOL") return { ok: false, reason: "TERMINAL_TURN_REQUIRED" };
      if (!validSkeptic(raw)) return { ok: false, reason: "SCHEMA_VALIDATION_FAILURE" };
      const narrative = toSkepticOutput(raw);
      if (containsAuthoritativeMetric(narrative)) return { ok: false, reason: "AUTHORITATIVE_METRIC_REJECTED" };
      // Bilingual on purpose: the Skeptic now writes narrative fields in Russian (see this role's `system`
      // instruction above), so an English-only keyword check would reject a genuinely correct Russian
      // provenance challenge and force an unnecessary fallback every time targetProvenance is set.
      const provenanceMissing = Boolean(metadata?.targetProvenance) && !/leak|circular|derived|constructed|reuse|утечк|циркуляр|производн|сконструирова|повторно использ|переиспольз/i.test(narrative.challenge ?? "");
      if (provenanceMissing) return { ok: false, reason: "PROVENANCE_CHALLENGE_MISSING" };
      if (!validRefs(narrative.evidenceRefs, evidenceAtEnd)) return { ok: false, reason: "INVALID_EVIDENCE_REFERENCE" };
      return { ok: true, terminal: narrative };
    },
    request: options.request, now,
  });

  if (skepticOutcome.source === "FALLBACK") {
    return { investigator: { ...investigator, source: "LLM" }, skeptic: fallbackSkeptic(evidenceAfterInvestigator, metadata), llmCalls: investigatorOutcome.llmCalls + skepticOutcome.llmCalls, agentCalls: [investigatorOutcome.call, skepticOutcome.call], onDemandEvidence: [...investigatorOutcome.newEvidence, ...skepticOutcome.newEvidence], toolTrace: [...investigatorOutcome.toolTrace, ...skepticOutcome.toolTrace] };
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
