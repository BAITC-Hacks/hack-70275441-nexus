import { analyzeGeneric } from "@/lib/nexus/adapters/generic/analyze";
import { executeAdmitted } from "../universal/admission.ts";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import { runLiveInvestigator } from "./liveInvestigator";
import { runLiveSkeptic } from "./liveSkeptic";
import { observeCandidates } from "./observer";
import { chooseInvestigatorActions } from "./investigator";
import { buildPrecursorChain } from "./precursorChain";
import { buildNextSteps } from "./nextSteps";
import { resolveToolPack } from "./resolveToolPack";
import type { NexusToolDefinition } from "./toolPack";
import { displayDomainLabel, displayLabel } from "../report/displayLabels.ts";
import {
  MAX_AGENT_STEPS,
  MAX_LLM_CALLS,
  MAX_REVISION_ROUNDS,
  MAX_TOOL_CALLS,
  type AgenticResult,
  type EvidenceRecord,
  type InvestigationProgress,
  type ToolContext,
  type TraceEvent,
} from "./types";

const now = () => new Date().toISOString();

export async function runAgenticInvestigation(
  dataset: UploadedDataset,
  signals: string[],
  onProgress?: (progress: InvestigationProgress) => void,
  target?: string,
  scenario: "generic" = "generic",
  /** The analyst's stated investigation objective; passed to the live agents as their goal. */
  objective?: string,
  observationTimeColumn?: string,
  /** Presentation label resolution only (Domain Registry vs. generic prettifier) — selects no steps, tools or evidence. */
  domainId?: string,
): Promise<{
  analysis: ReturnType<typeof analyzeGeneric>;
  agentic: AgenticResult;
}> {
  executeAdmitted({ dataset, signals, taskId: scenario, mapping: { date: observationTimeColumn, target } }, () => undefined);
  const started = Date.now();
  const domainPack = resolveToolPack(scenario);
  const dispatchPool: NexusToolDefinition[] = domainPack;
  onProgress?.({
    stage: "DATA_ACQUIRED",
    source: "DETERMINISTIC",
    detail: "Набор данных принят для описательного расследования.",
  });
  const profilingStarted = Date.now();
  const analysis = analyzeGeneric(dataset, signals);
  const precursorChain = buildPrecursorChain(dataset, analysis, target);
  const nextSteps = buildNextSteps(dataset, analysis, precursorChain, domainId);
  const profiling = Date.now() - profilingStarted;
  onProgress?.({
    stage: "SIGNALS_DETECTED",
    source: "DETERMINISTIC",
    detail: "Данные профилированы, выявлены кандидаты в сигналы.",
  });

  const context: ToolContext = { dataset, signals };
  const trace: TraceEvent[] = [];
  const evidence: EvidenceRecord[] = [];
  const stats = {
    agentSteps: 0,
    toolCalls: 0,
    llmCalls: 0,
    revisionRounds: 0,
    executionLimitReached: false,
  };
  const event = (
    agent: TraceEvent["agent"],
    type: TraceEvent["event"],
    summary: string,
    tool?: string,
    evidenceRefs?: string[],
    source: TraceEvent["source"] = "DETERMINISTIC",
  ) => trace.push({ timestamp: now(), agent, event: type, summary, tool, evidenceRefs, source });
  const tool = (
    name: string,
    arguments_: Record<string, string>,
    usedBy: string[],
  ) => {
    if (stats.toolCalls >= MAX_TOOL_CALLS) {
      stats.executionLimitReached = true;
      return "";
    }
    const definition = dispatchPool.find((item) => item.name === name);
    if (!definition) return "";
    stats.toolCalls += 1;
    event("TOOL", "TOOL_CALLED", `Running ${name}.`, name, undefined, "DETERMINISTIC");
    const result = definition.execute(context, arguments_);
    const id = `E-${String(evidence.length + 1).padStart(3, "0")}`;
    evidence.push({
      id,
      tool: name,
      variables: result.variables,
      result: result.summary,
      data: result.data,
      usedBy,
    });
    event("TOOL", "TOOL_RESULT", result.summary, name, [id], "DETERMINISTIC");
    return id;
  };

  event(
    "ORCHESTRATOR",
    "INVESTIGATION_STARTED",
    "Generic investigation received; deterministic tools operate only on the active dataset.",
  );
  const observerStarted = Date.now();
  event(
    "OBSERVER",
    "AGENT_STARTED",
    "Observer is inspecting descriptive movement, not explaining cause.",
  );
  stats.agentSteps += 1;
  const observerPlan = observeCandidates(analysis);
  const primary = observerPlan.columns;
  const observerEvidence = observerPlan.actions
    .map((action) => tool("inspect_directional_movement", action.arguments ?? {}, ["OBSERVER"]))
    .filter(Boolean);
  // The tool summary already opens with the column name, so it is used as-is rather than prefixed twice.
  const observerFindings = primary.map(
    (column, index) =>
      evidence.find((item) => item.id === observerEvidence[index])?.result ?? `${column}: no directional observation.`,
  );
  const observer = Date.now() - observerStarted;
  event(
    "OBSERVER",
    "AGENT_DECISION",
    primary.length
      ? `Selected ${primary.join(", ")} as up to three descriptive investigation candidates.`
      : "No primary descriptive candidate exceeded the configured outlier rule.",
    undefined,
    observerEvidence,
  );

  const focus = primary[0] ?? signals[0];
  const comparison = primary[1] ?? signals.find((signal) => signal !== focus);
  const investigatorTool: number[] = [];
  onProgress?.({
    stage: "INVESTIGATOR_SELECTING_CHECK",
    source: process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK",
    detail: "Investigator выбирает ограниченную детерминированную проверку.",
  });
  event(
    "INVESTIGATOR",
    "AGENT_STARTED",
    "Investigator is selecting targeted deterministic evidence.",
    undefined,
    undefined,
    process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK",
  );
  stats.agentSteps += 1;
  const liveInvestigator = await runLiveInvestigator({
    context,
    observerFindings,
    evidence,
    remainingLlmCalls: MAX_LLM_CALLS - stats.llmCalls,
    pack: domainPack,
    objective,
    execute: (name, args) => {
      onProgress?.({
        stage: "INVESTIGATOR_TOOL_EXECUTING",
        source: "DETERMINISTIC",
        detail: `Investigator выбрал ${name}; выполняется детерминированный инструмент.`,
      });
      const toolStarted = Date.now();
      const id = tool(name, args, ["INVESTIGATOR"]);
      investigatorTool.push(Date.now() - toolStarted);
      return evidence.find((item) => item.id === id)!;
    },
  });
  stats.llmCalls += liveInvestigator.llmCalls;
  onProgress?.({
    stage: "HYPOTHESIS_FORMED",
    source: liveInvestigator.source,
    detail:
      liveInvestigator.source === "LLM"
        ? "Investigator сформировал рабочую гипотезу на основе детерминированных доказательств."
        : "Investigator перешёл на консервативную резервную гипотезу.",
  });
  liveInvestigator.actions.forEach((action) =>
    event(
      "INVESTIGATOR",
      action.action === "FORM_HYPOTHESIS" ? "HYPOTHESIS_CREATED" : "AGENT_DECISION",
      action.summary,
      action.tool,
      action.evidenceRefs,
      action.source,
    ),
  );

  const hypothesisEvidence = liveInvestigator.hypothesis.supportingEvidence;
  const baseHypothesis = liveInvestigator.hypothesis.primary;
  const skepticTool: number[] = [];
  onProgress?.({
    stage: "SKEPTIC_CHALLENGING",
    source: process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK",
    detail: "Skeptic выбирает встречную детерминированную проверку.",
  });
  event(
    "SKEPTIC",
    "AGENT_STARTED",
    "Skeptic is selecting an adversarial deterministic check.",
    undefined,
    undefined,
    process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK",
  );
  stats.agentSteps += 1;
  const liveSkeptic = await runLiveSkeptic({
    context,
    hypothesis: baseHypothesis,
    alternative: liveInvestigator.hypothesis.alternative,
    observerFindings,
    evidence,
    remainingLlmCalls: MAX_LLM_CALLS - stats.llmCalls,
    pack: domainPack,
    objective,
    execute: (name, args) => {
      onProgress?.({
        stage: "SKEPTIC_TOOL_EXECUTING",
        source: "DETERMINISTIC",
        detail: `Skeptic выбрал ${name}; выполняется детерминированный инструмент.`,
      });
      const toolStarted = Date.now();
      const id = tool(name, args, ["SKEPTIC"]);
      skepticTool.push(Date.now() - toolStarted);
      return evidence.find((item) => item.id === id)!;
    },
  });
  stats.llmCalls += liveSkeptic.llmCalls;
  liveSkeptic.actions.forEach((action) =>
    event(
      "SKEPTIC",
      action.action === "FINAL_VERDICT" ? "CHALLENGE_CREATED" : "AGENT_DECISION",
      action.summary,
      action.tool,
      action.evidenceRefs,
      action.source,
    ),
  );

  const outlierEvidence = liveSkeptic.verdict.evidenceRefs.at(-1) ?? "";
  let revised = false;
  let revision: number | undefined;
  let finalPrimary = baseHypothesis;
  let status: AgenticResult["skepticReview"]["status"] = liveSkeptic.verdict.status;
  let challenge = liveSkeptic.verdict.challenge;
  if (
    status === "CHALLENGED" &&
    stats.revisionRounds < MAX_REVISION_ROUNDS &&
    stats.agentSteps < MAX_AGENT_STEPS
  ) {
    const revisionStarted = Date.now();
    stats.revisionRounds += 1;
    stats.agentSteps += 1;
    onProgress?.({
      stage: "HYPOTHESIS_REVISED",
      source: "DETERMINISTIC",
      detail: "Skeptic оспорил гипотезу; она возвращена на один ограниченный пересмотр.",
    });
    event(
      "ORCHESTRATOR",
      "AGENT_DECISION",
      "Returning H-01 to Investigator for one bounded revision pass.",
      undefined,
      [outlierEvidence].filter(Boolean),
    );
    const revisionAction = chooseInvestigatorActions(focus, comparison, true).find(
      (action) => action.tool === "inspect_missingness",
    );
    const missingEvidence = revisionAction
      ? tool("inspect_missingness", revisionAction.arguments ?? {}, ["INVESTIGATOR"])
      : "";
    revised = true;
    const focusLabel = focus ? (domainId ? displayDomainLabel(focus, domainId) : displayLabel(focus)) : undefined;
    finalPrimary = focusLabel
      ? `Показатель «${focusLabel}» остаётся описательным наблюдением, но связь с ним ослаблена: чувствительность к выбросам требует дополнительной отраслевой проверки.`
      : baseHypothesis;
    event(
      "INVESTIGATOR",
      "HYPOTHESIS_REVISED",
      "H-01 revised to H-02 with explicit outlier limitation.",
      undefined,
      [missingEvidence, ...hypothesisEvidence].filter(Boolean),
    );
    stats.agentSteps += 1;
    status = "INCONCLUSIVE";
    challenge = "После ограниченного пересмотра гипотеза остаётся описательной и неопределённой, а не причинной.";
    event("SKEPTIC", "CHALLENGE_CREATED", challenge, undefined, [outlierEvidence, missingEvidence].filter(Boolean));
    revision = Date.now() - revisionStarted;
  }

  if (
    stats.agentSteps >= MAX_AGENT_STEPS ||
    stats.toolCalls >= MAX_TOOL_CALLS ||
    stats.llmCalls >= MAX_LLM_CALLS
  ) {
    stats.executionLimitReached = true;
  }
  const finalAssessment = stats.executionLimitReached
    ? "Расследование остановлено по достижении установленного лимита выполнения."
    : status === "INCONCLUSIVE"
      ? "Расследование завершено: собраны описательные наблюдения; альтернативные объяснения не исключены."
      : "Рабочая гипотеза выдержала проверку Skeptic; это не является доказательством причинности.";
  event("ORCHESTRATOR", "INVESTIGATION_COMPLETED", finalAssessment, undefined, evidence.map((item) => item.id));
  onProgress?.({
    stage: "VERDICT_READY",
    source: liveSkeptic.source,
    detail:
      liveSkeptic.source === "LLM"
        ? "Вердикт Skeptic готов, со ссылками на проверяемые доказательства."
        : "Готов безопасный резервный вердикт; детерминированные доказательства доступны.",
  });

  return {
    analysis,
    agentic: {
      observerFindings,
      hypothesis: {
        primary: finalPrimary,
        alternative: liveInvestigator.hypothesis.alternative,
        supportingEvidence: hypothesisEvidence,
        limitations: liveInvestigator.hypothesis.limitations,
        revised,
      },
      skepticReview: {
        status,
        challenge,
        alternatives: liveSkeptic.verdict.alternatives,
        evidenceRefs: liveSkeptic.verdict.evidenceRefs,
      },
      finalAssessment,
      evidence,
      trace,
      executionStats: stats,
      precursorChain,
      nextSteps,
      timings: {
        profiling,
        observer,
        investigatorLlm: liveInvestigator.latencies,
        investigatorTool,
        skepticLlm: liveSkeptic.latencies,
        skepticTool,
        revision,
        total: Date.now() - started,
      },
      investigator: {
        source: liveInvestigator.source,
        toolCalls: liveInvestigator.toolCalls,
        latencies: liveInvestigator.latencies,
        runtime: liveInvestigator.runtime,
      },
      skeptic: {
        source: liveSkeptic.source,
        toolCalls: liveSkeptic.toolCalls,
        latencies: liveSkeptic.latencies,
        runtime: liveSkeptic.runtime,
      },
    },
  };
}
