import type { UploadedDataset } from "../ingestion/types.ts";
import type { AgenticResult, PrecursorEdge } from "../agentic/types.ts";
import type { TimeSeriesArtifact, TimeSeriesValidation } from "../timeSeries/validator.ts";
import { interpretTemporalEdge } from "./interpretation.ts";
import { displayDomainLabel, displayLabel, displayUnit, relabelDomainEvidenceSummary, ruDecimal } from "./displayLabels.ts";
import { getDomainPack, getMetricDefinition } from "../domains/registry.ts";
import { inferPresentationCadence, formatLag, formatLagRange } from "./timeUnits.ts";

const strengthLabels = { very_weak: "Очень слабая", weak: "Слабая", moderate: "Умеренная", strong: "Сильная", very_strong: "Очень сильная" } as const;
const statusLabels: Record<string, string> = {
  NO_MEANINGFUL_DETERIORATION: "Существенного ухудшения не обнаружено",
  DETERIORATION_OBSERVED: "Обнаружено ухудшение", MIXED_EVIDENCE: "Смешанные свидетельства",
  INSUFFICIENT_DATA: "Недостаточно данных", IMPROVEMENT_OBSERVED: "Наблюдается улучшение",
};
/** Presentation only. No new statistics, Evidence, validation, simulation or intervention selection. */
export function buildInvestigationViewModel(input: {
  artifact: TimeSeriesArtifact; validation: TimeSeriesValidation; dataset: UploadedDataset;
  evidence: AgenticResult["evidence"]; domainId?: string;
  agentic?: Pick<AgenticResult, "hypothesis" | "skepticReview" | "finalAssessment" | "nextSteps" | "investigator" | "skeptic">;
}) {
  const { artifact, validation, dataset, evidence, domainId, agentic } = input;
  const cadence = inferPresentationCadence(dataset, artifact.inputs.date);
  const pack = domainId ? getDomainPack(domainId) : undefined;
  const cards = artifact.precursorChain.edges.map(edge => {
    const interpretation = interpretTemporalEdge(structuredClone(edge) as PrecursorEdge, domainId);
    const observedLead = interpretation.temporal.measuredLagPeriods !== undefined && interpretation.temporal.measuredLagPeriods > 0
      && interpretation.significance.status === "statistically_significant";
    const prior = pack?.causalPriors?.find(p => p.from === interpretation.canonicalMetric && p.to === edge.to && p.relation === "potential_precursor");
    const early = observedLead && Boolean(prior) && interpretation.role === "leading_signal" && interpretation.temporal.status === "consistent_with_domain_prior";
    const supported = interpretation.significance.status === "statistically_significant";
    const presentationState = early ? "early_signal" : observedLead ? "observed_leading_association" : supported ? "association_without_lead" : "not_supported";
    return { interpretation, edge, early, observedLead, presentationState,
      measuredLagLabel: interpretation.temporal.measuredLagPeriods === undefined ? "Нет данных" : formatLag(interpretation.temporal.measuredLagPeriods, cadence),
      expectedLagLabel: interpretation.temporal.expectedLagPeriods ? formatLagRange(interpretation.temporal.expectedLagPeriods, cadence) : "Не зарегистрирован",
      headline: edge.lagPeriods === 0 ? `Наблюдаемая связь с «${domainId ? displayDomainLabel(edge.to, domainId) : displayLabel(edge.to)}». Временного опережения не обнаружено.`
        : `Наблюдаемая связь с «${domainId ? displayDomainLabel(edge.to, domainId) : displayLabel(edge.to)}»: ${edge.lagPeriods > 0 ? "опережение" : "запаздывание"} на ${formatLag(Math.abs(edge.lagPeriods), cadence)}.`,
      badge: early ? "РАННИЙ СИГНАЛ" : observedLead ? "НАБЛЮДАЕМАЯ ОПЕРЕЖАЮЩАЯ СВЯЗЬ" : supported ? "СВЯЗЬ БЕЗ ОПЕРЕЖЕНИЯ" : "СИГНАЛ НЕ ПОДТВЕРЖДЁН",
      strengthLabel: interpretation.strength ? strengthLabels[interpretation.strength] : "Не определена",
      significanceLabel: supported ? "Связь статистически значима после коррекции" : interpretation.significance.status === "unknown" ? "Значимость неизвестна" : "Статистическая значимость не установлена",
      priorLabel: interpretation.temporal.status === "consistent_with_domain_prior" ? "Соответствует отраслевой гипотезе"
        : interpretation.temporal.status === "outside_expected_range" ? "Вне ожидаемого отраслевого диапазона" : "Для этой метрики нет зарегистрированного отраслевого ожидания по опережению.",
    };
  });
  const target = artifact.inputs.target;
  const observed = target ? dataset.rows.flatMap((row, index) => typeof row[target] === "number" && Number.isFinite(row[target])
    ? [{ index, value: row[target] as number, period: artifact.inputs.date ? String(row[artifact.inputs.date]) : String(index + 1) }] : []) : [];
  const resolvedTargetLabel = target ? (domainId ? getMetricDefinition(domainId, target)?.labelRu : undefined) ?? displayLabel(target) : undefined;
  const resolvedTargetUnit = target && domainId ? displayUnit(getMetricDefinition(domainId, target)?.unit) : undefined;
  /**
   * One synthesized, deterministic finding sentence for the top of the Decision View — assembled only from
   * values already computed above (the observed target's first/last value, and the strongest-by-|correlation|
   * card's existing domain-aware label/lag). No new statistics, no causal claim: "статистически связан" and
   * "наблюдаемая связь" only, matching the same vocabulary every other sentence on this screen already uses.
   */
  const strongestCard = cards.length ? cards.reduce((best, card) => Math.abs(card.edge.correlation) > Math.abs(best.edge.correlation) ? card : best) : undefined;
  const headline = resolvedTargetLabel && observed.length >= 2
    ? `Значение показателя «${resolvedTargetLabel}» изменилось с ${ruDecimal(observed[0].value.toFixed(2))} до ${ruDecimal(observed.at(-1)!.value.toFixed(2))}${resolvedTargetUnit ? ` ${resolvedTargetUnit}` : ""} за период наблюдения. ${strongestCard && strongestCard.edge.significant
        ? `Сильнее всего с ним статистически связан показатель «${strongestCard.interpretation.displayName}» (${strongestCard.measuredLagLabel} измеренного лага) — это наблюдаемая связь, а не установленная причинность.`
        : "Устойчивых статистически значимых связей с другими показателями в этом наборе данных не обнаружено."}`
    : undefined;
  const alternative = evidence.find(e => e.tool === "compare_alternative_factors");
  const temporal = evidence.find(e => e.tool === "inspect_temporal_order");
  const factors = alternative && Array.isArray(alternative.data.factors) ? alternative.data.factors.flatMap((factor: unknown) => {
    if (!factor || typeof factor !== "object") return [];
    const f = factor as Record<string, unknown>;
    return typeof f.column === "string" && typeof f.status === "string" ? [{ label: domainId ? displayDomainLabel(f.column, domainId) : displayLabel(f.column), status: statusLabels[f.status] ?? "Результат требует технической проверки" }] : [];
  }) : [];
  const ordering = temporal && Array.isArray(temporal.data.ordering) ? temporal.data.ordering.flatMap((step: unknown) => {
    if (!step || typeof step !== "object") return [];
    const s = step as Record<string, unknown>;
    return typeof s.sourceRow === "number" && Array.isArray(s.signals) ? [{ row: s.sourceRow, labels: s.signals.filter((v): v is string => typeof v === "string").map(v => domainId ? displayDomainLabel(v, domainId) : displayLabel(v)) }] : [];
  }) : [];
  const lastRow = dataset.rows.at(-1);
  const baseline = Object.fromEntries(Object.entries(lastRow ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  const scenario = pack?.scenario ? { input: { domainId: pack.id, baseline }, config: pack.scenario,
    units: Object.fromEntries(Object.values(pack.metrics ?? {}).map(m => [m.canonicalName, displayUnit(m.unit)])), cadence } : undefined;
  const relevantCards = cards.filter(card => card.early);
  const displayedCards = (relevantCards.length ? relevantCards : cards.filter(card => card.observedLead && card.edge.significant)).slice(0, 3);
  const evidenceByRefs = (refs: string[]) => refs.flatMap(id => {
    const record = evidence.find(item => item.id === id);
    return record ? [{ id: record.id, tool: record.tool, variables: record.variables.map(variable => domainId ? displayDomainLabel(variable, domainId) : displayLabel(variable)), summary: domainId ? relabelDomainEvidenceSummary(record.result, domainId) : record.result }] : [];
  });
  const story = agentic ? {
    investigator: { source: agentic.investigator.source, hypothesis: agentic.hypothesis.primary, alternative: agentic.hypothesis.alternative,
      evidence: evidenceByRefs(agentic.hypothesis.supportingEvidence) },
    relationships: displayedCards.map(card => ({ metric: card.interpretation.metric, label: card.interpretation.displayName, headline: card.headline, significance: card.significanceLabel })),
    skeptic: { source: agentic.skeptic.source, status: agentic.skepticReview.status, challenge: agentic.skepticReview.challenge,
      alternatives: agentic.skepticReview.alternatives, evidence: evidenceByRefs(agentic.skepticReview.evidenceRefs) },
    conclusion: agentic.finalAssessment,
    uncertainty: ["Причинно-следственная связь не установлена.", ...agentic.hypothesis.limitations],
    nextSteps: agentic.nextSteps,
  } : undefined;
  return { cards, cadence, scenario, headline, targetLabel: resolvedTargetLabel ?? "Целевой показатель не выбран",
    targetUnit: resolvedTargetUnit,
    observed, latest: observed.at(-1), first: observed[0],
    associationScore: artifact.precursorChain.riskIndicator * 100,
    associationIndexLabel: `Эвристический индекс: ${Math.round(artifact.precursorChain.riskIndicator * 100)}/100`,
    associationLabel: ({ LOW: "низкая", MEDIUM: "средняя", HIGH: "высокая" } as const)[artifact.precursorChain.riskLabel],
    validationStatus: validation.status, artifactHash: validation.validatedArtifactHash,
    alternatives: { evidence: alternative, factors, message: alternative ? statusLabels[String(alternative.data.status)] ?? "См. результат инструмента" : "Не проверены в этом прогоне." },
    temporalEvidence: temporal, ordering,
    recommendation: displayedCards.length ? `Проверить исходные условия и динамику показателей: ${displayedCards.map(card => card.interpretation.displayName).join("; ")}.`
      : "Сначала проверить качество данных и доступные свидетельства.",
    evidence, story,
  };
}
export type InvestigationViewModel = ReturnType<typeof buildInvestigationViewModel>;
