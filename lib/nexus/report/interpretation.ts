import { getDomainPack, getMetricDefinition, resolveMetricAlias } from "../domains/registry.ts";
import type { ExpectedLagPeriods, MetricRole, RiskDirection } from "../domains/types.ts";
import type { PrecursorEdge } from "../agentic/types.ts";
import { displayLabel } from "./displayLabels.ts";

export type CorrelationStrength = "very_weak" | "weak" | "moderate" | "strong" | "very_strong";
export type MetricResult = {
  domainId?: string;
  metric: string;
  targetMetric?: string;
  correlation?: number;
  lagPeriods?: number;
  pValue?: number | null;
  confidenceInterval?: readonly [number, number] | null;
  /** If supplied, this is the existing pipeline's corrected decision, not a new calculation. */
  significant?: boolean;
  movement?: "rising" | "falling" | "stable";
  bootstrap?: PrecursorEdge["bootstrap"];
};
export type MetricInterpretation = {
  domainId?: string;
  metric: string;
  canonicalMetric: string;
  displayName: string;
  role?: MetricRole;
  riskDirection?: RiskDirection;
  unit?: string;
  technical: {
    correlation?: number;
    lagPeriods?: number;
    pValue?: number;
    confidenceInterval?: [number, number];
    bootstrap?: PrecursorEdge["bootstrap"];
  };
  strength?: CorrelationStrength;
  temporal: {
    measuredLagPeriods?: number;
    expectedLagPeriods?: ExpectedLagPeriods;
    status: "consistent_with_domain_prior" | "outside_expected_range" | "no_domain_prior" | "not_temporally_leading";
  };
  significance: {
    status: "statistically_significant" | "not_statistically_significant" | "unknown";
    basis: "pipeline_decision" | "p_value" | "unknown";
  };
  directionAssessment: { status: "consistent" | "inconsistent" | "neutral" | "not_applicable" };
  headline: string;
  explanation: string;
  limitations: string[];
};

/** Descriptive magnitude only; this does not calculate significance or confidence. */
export function classifyCorrelationStrength(r: number): CorrelationStrength | undefined {
  if (!Number.isFinite(r) || Math.abs(r) > 1) return undefined;
  const magnitude = Math.abs(r);
  return magnitude < .2 ? "very_weak" : magnitude < .4 ? "weak" : magnitude < .6 ? "moderate" : magnitude < .8 ? "strong" : "very_strong";
}

export const strengthText: Record<CorrelationStrength, string> = {
  very_weak: "очень слабая", weak: "слабая", moderate: "умеренная", strong: "сильная", very_strong: "очень сильная",
};

/** Evidence/result + contextual metadata -> interpretation only.
 * Never creates Evidence, changes statistics, validates an artifact or authorizes an action.
 * Correlation sign is not observed movement; metadata is not an observation.
 */
export function interpretMetricResult(result: MetricResult): MetricInterpretation {
  const canonical = (result.domainId && resolveMetricAlias(result.domainId, result.metric)) || result.metric;
  const pack = result.domainId ? getDomainPack(result.domainId) : undefined;
  const metadata = result.domainId ? getMetricDefinition(result.domainId, canonical) : undefined;
  const name = metadata?.labelRu ?? displayLabel(canonical);
  const targetCanonical = result.targetMetric ? (result.domainId && resolveMetricAlias(result.domainId, result.targetMetric)) || result.targetMetric : undefined;
  const target = targetCanonical ? (result.domainId && getMetricDefinition(result.domainId, targetCanonical)?.labelRu) ?? displayLabel(targetCanonical) : "целевой показатель";
  const strength = result.correlation === undefined ? undefined : classifyCorrelationStrength(result.correlation);
  const correlation = strength ? result.correlation : undefined;
  const lag = Number.isInteger(result.lagPeriods) ? result.lagPeriods : undefined;
  const p = typeof result.pValue === "number" && Number.isFinite(result.pValue) && result.pValue >= 0 && result.pValue <= 1 ? result.pValue : undefined;
  const ci = result.confidenceInterval;
  const validCi = ci && ci.every(v => Number.isFinite(v) && Math.abs(v) <= 1) && ci[0] <= ci[1] ? [ci[0], ci[1]] as [number, number] : undefined;
  const expected = metadata?.expectedLagPeriods;
  const temporalStatus = lag !== undefined && lag <= 0 ? "not_temporally_leading"
    : lag !== undefined && expected && (expected.min !== undefined || expected.max !== undefined)
      ? ((expected.min === undefined || lag >= expected.min) && (expected.max === undefined || lag <= expected.max) ? "consistent_with_domain_prior" : "outside_expected_range")
      : "no_domain_prior";
  // Raw p-value must not overrule the caller's existing Holm-corrected decision.
  const significance: MetricInterpretation["significance"] = p === undefined ? { status: "unknown", basis: "unknown" }
    : { status: (result.significant ?? p < .05) ? "statistically_significant" : "not_statistically_significant", basis: result.significant === undefined ? "p_value" : "pipeline_decision" };
  let direction: MetricInterpretation["directionAssessment"]["status"] = "not_applicable";
  if (result.movement && metadata) {
    if (metadata.riskDirection === "neutral") direction = "neutral";
    else if (metadata.riskDirection !== "deviation_is_worse") {
      const adverse = metadata.riskDirection === "higher_is_worse" ? "rising" : "falling";
      direction = result.movement === "stable" ? "neutral" : result.movement === adverse ? "consistent" : "inconsistent";
    }
  }
  const limits = ["Корреляция и временное опережение не доказывают причинность и не исключают альтернативные объяснения."];
  if (pack && metadata) limits.push("Domain priors — контекстные метаданные, а не наблюдаемое Evidence.");
  if (lag === undefined) limits.push("Измеренный лаг отсутствует; временное соответствие не установлено.");
  if (direction === "not_applicable") limits.push("Направление ухудшения не установлено: знак корреляции не определяет движение показателя.");
  if (significance.status === "unknown") limits.push("Статистическая значимость неизвестна.");
  if (result.correlation !== undefined && correlation === undefined) limits.push("Некорректное значение корреляции не интерпретируется.");
  let headline = `${name}: данных о связи недостаточно`;
  if (correlation !== undefined) {
    headline = lag === 0 ? `${name}: связь с «${target}» без временного опережения`
      : lag !== undefined && lag > 0 ? `${name}: оценена связь с «${target}» с опережением на ${lag} периода`
      : lag !== undefined && lag < 0 ? `${name}: связь с «${target}» с запаздыванием на ${Math.abs(lag)} периода`
      : `${name}: оценена связь с «${target}»`;
    if (significance.status === "not_statistically_significant") headline += "; статистическая значимость не установлена";
  }
  const sentences: string[] = [];
  if (correlation !== undefined && strength) sentences.push(`Наблюдаемая связь с «${target}»: ${strengthText[strength]}, ${correlation < 0 ? "отрицательная" : correlation > 0 ? "положительная" : "нулевая"} (r=${correlation}).`);
  if (lag !== undefined) sentences.push(lag === 0 ? "Измеренный лаг равен нулю: временного опережения нет." : `Измеренный лаг: ${lag} периода.`);
  if (temporalStatus === "consistent_with_domain_prior") sentences.push(`Измеренный лаг согласуется с зарегистрированным ожидаемым диапазоном ${expected?.min ?? "без нижней границы"}–${expected?.max ?? "без верхней границы"}; это соответствие domain prior.`);
  else if (temporalStatus === "outside_expected_range") sentences.push("Измеренный лаг находится вне зарегистрированного ожидаемого диапазона.");
  else if (!expected) sentences.push("Ожидаемый domain lag не зарегистрирован.");
  if (significance.basis === "pipeline_decision") sentences.push("Значимость сохранена из решения statistical pipeline; исходный p-value не заменяет коррекцию множественных проверок.");
  if (significance.status === "not_statistically_significant") sentences.push("Статистически значимая связь не установлена.");
  sentences.push(limits[0]);
  return {
    domainId: result.domainId, metric: result.metric, canonicalMetric: canonical, displayName: name,
    role: metadata?.role, riskDirection: metadata?.riskDirection, unit: metadata?.unit,
    technical: { correlation, lagPeriods: lag, pValue: p, confidenceInterval: validCi, ...(result.bootstrap !== undefined ? { bootstrap: result.bootstrap ? { ...result.bootstrap, ci95: { ...result.bootstrap.ci95 } } : null } : {}) },
    strength, temporal: { measuredLagPeriods: lag, expectedLagPeriods: expected ? { ...expected } : undefined, status: temporalStatus },
    significance, directionAssessment: { status: direction }, headline, explanation: sentences.join(" "), limitations: limits,
  };
}

/** Adapter for existing precursor edges: keeps the pipeline's Holm decision and bootstrap intact. */
export function interpretTemporalEdge(edge: PrecursorEdge, domainId?: string): MetricInterpretation {
  return interpretMetricResult({ domainId, metric: edge.from, targetMetric: edge.to,
    correlation: edge.correlation, lagPeriods: edge.lagPeriods, pValue: edge.pValue,
    significant: edge.significant, confidenceInterval: edge.ci95 ? [edge.ci95.lower, edge.ci95.upper] : null, bootstrap: edge.bootstrap });
}
