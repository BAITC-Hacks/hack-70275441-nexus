import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { AgenticResult } from "@/lib/nexus/agentic/types";
import { displayLabel, displayDomainLabel, relabelFieldPrefix, relabelDomainEvidenceSummary, ruDecimal } from "./displayLabels.ts";

export interface BusinessSummary {
  /** WHAT IS HAPPENING — one plain-language statement of the observed situation. */
  headline: string;
  /** WHY IT MATTERS — the practical consequence, stated without forecasting or causal claims. */
  whyItMatters: string;
  /** WHAT NEXUS FOUND — the concrete observations behind the headline. */
  findings: string[];
}

/** Russian noun/adjective plural agreement for a count (1 → one, 2-4 → few, 0/5+ → many). */
const pluralize = (count: number, one: string, few: string, many: string): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** A lag of 0 is co-movement, not a lead — saying "опережает на 0 периодов" would overstate what was measured. */
export const describeLag = (lag: number) =>
  lag === 0
    ? "движется синхронно с ним, без измеримого опережения"
    : `опережает его на ${lag} ${pluralize(lag, "период", "периода", "периодов")}`;

const RISK_MEANING: Record<AgenticResult["precursorChain"]["riskLabel"], string> = {
  HIGH: "Несколько сигналов движутся в тесной связи с итоговым показателем, поэтому изменение любого из них, вероятно, отразится и на нём.",
  MEDIUM: "Некоторые сигналы движутся вместе с итоговым показателем, но эта связь недостаточно устойчива, чтобы полагаться на неё одну.",
  LOW: "Ни один сигнал в этом наборе данных не движется достаточно тесно с итоговым показателем, чтобы считать его ранним индикатором.",
};

const directionVerb = (direction: "rising" | "falling", count: number): string => {
  const plural = count !== 1;
  if (direction === "rising") return plural ? "растут" : "растёт";
  return plural ? "снижаются" : "снижается";
};

/**
 * Turns the deterministic investigation output into the plain-language layer of the result page.
 * Every sentence is assembled from computed values — nothing here forecasts an event or claims causality,
 * because neither is supported by a lag-correlation scan (see docs/methodology.md). The wording is written
 * as natural Russian business prose (not translated word-for-word from an English template) but preserves
 * the exact same statistical meaning and every underlying number.
 */
export function buildBusinessSummary(analysis: GenericAnalysis, agentic: AgenticResult, domainId?: string): BusinessSummary {
  const label = (id: string) => (domainId ? displayDomainLabel(id, domainId) : displayLabel(id));
  const relabel = (text: string) => (domainId ? relabelDomainEvidenceSummary(text, domainId) : relabelFieldPrefix(text));

  const chain = agentic.precursorChain;
  const strongest = chain.edges.length
    ? chain.edges.reduce((best, edge) => (Math.abs(edge.correlation) > Math.abs(best.correlation) ? edge : best))
    : undefined;
  const anchor = strongest?.to ?? chain.edges[0]?.to;
  const movingSignals = analysis.findings.filter((finding) => Math.abs(finding.zScore) >= 1);

  const headline = strongest && anchor
    ? `${label(anchor)} — исследуемый итоговый показатель. В наборе данных выявлено ${chain.edges.length} ${pluralize(chain.edges.length, "сигнал, связанный", "сигнала, связанных", "сигналов, связанных")} с его изменением, — сильнее всего ${label(strongest.from)}, который ${describeLag(strongest.lagPeriods)} (r = ${ruDecimal(strongest.correlation.toFixed(2))} по ${strongest.n} парным наблюдениям).`
    : movingSignals.length
      ? `${label(movingSignals[0].column)} — наиболее нетипичный сигнал в этом наборе данных (отклоняется от собственного базового уровня ${movingSignals[0].zScore > 0 ? "выше" : "ниже"} на ${ruDecimal(Math.abs(movingSignals[0].zScore).toFixed(1))} стандартных отклонений), но опережающую связь с итоговым показателем вычислить не удалось.`
      : "Ни один сигнал в этом наборе данных не отклоняется от собственного базового уровня достаточно, чтобы открыть расследование риска.";

  const stillMoving = movingSignals.filter((finding) => chain.edges.some((edge) => edge.from === finding.column));
  const whyItMatters = strongest
    ? `${RISK_MEANING[chain.riskLabel]} ${stillMoving.length ? `${stillMoving.length} из ведущих сигналов по-прежнему ${directionVerb(stillMoving[0].direction, stillMoving.length)} по состоянию на последнее наблюдение.` : "Ни один из ведущих сигналов в настоящее время не является выбросом относительно собственного базового уровня."} Это описывает, как сигналы двигались совместно, — это не устанавливает, что один вызвал другой, и не является прогнозом.`
    : "Без вычисленной опережающей связи этот набор данных поддерживает только мониторинг — здесь нет доказательной базы для решения о вмешательстве.";

  const findings = [
    // observerFindings are deterministic tool-output sentences shaped "<canonicalId>: <sentence>" —
    // only the leading identifier is relabeled for display; the sentence and its numbers are untouched,
    // and the underlying EvidenceRecord this text came from is never mutated.
    ...agentic.observerFindings.slice(0, 3).map(relabel),
    ...chain.edges.slice(0, 3).map((edge) => `${label(edge.from)} → ${label(edge.to)}: r = ${ruDecimal(edge.correlation.toFixed(2))}; ${edge.lagPeriods === 0 ? "измеримое временное опережение не выявлено" : `опережение на ${edge.lagPeriods} ${pluralize(edge.lagPeriods, "период", "периода", "периодов")}`}; n = ${edge.n}; ${edge.significant ? "результат сохраняет статистическую значимость после поправки Холма" : "результат не достиг статистической значимости после поправки Холма"}.`),
  ].filter(Boolean);

  return { headline, whyItMatters, findings };
}
