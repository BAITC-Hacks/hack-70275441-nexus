import type { DomainScenario } from "../nexus/domains/types.ts";
import { getDomainPack } from "../nexus/domains/registry.ts";

export type ScenarioInput = { domainId: string; baseline: Record<string, number>; changePct: number };
export type ScenarioResult = { status: "AVAILABLE"; domainId: string; controlMetric: string; baselineValue: number; scenarioValue: number; changePct: number; requestedChangePct: number; requestedUnboundedValue: number; boundedScenarioValue: number; effectiveChangePct: number | null; controlBound?: { boundMetric: string; boundValue: number; boundReason: "configured_cap"; source: string }; impacts: { metric: string; baselineValue: number; simulatedValue: number; absoluteChange: number; relativeChangePct?: number }[]; assumptions: DomainScenario["relationships"]; bounded: boolean; boundsApplied: string[] } | { status: "UNAVAILABLE"; reason: string };

/** Absolute-unit calibrated effects; never accepts correlations or agent arithmetic. */
export function simulateDomainScenario(input: ScenarioInput, config = getDomainPack(input.domainId)?.scenario): ScenarioResult {
  const unavailable = (reason: string): ScenarioResult => ({ status: "UNAVAILABLE", reason });
  if (!config) return unavailable("Сценарная конфигурация отсутствует.");
  const c = config.control, change = input.changePct;
  if (![c.minChange, c.maxChange, c.step, change].every(Number.isFinite) || c.step <= 0 || c.minChange < 0 || c.maxChange < c.minChange || (c.maxChange - c.minChange) / c.step > 100 || change < c.minChange || change > c.maxChange || Math.abs((change - c.minChange) / c.step - Math.round((change - c.minChange) / c.step)) > 1e-8) return unavailable("Недопустимый уровень сценария.");
  const required = new Set([c.metric, ...(c.capMetric ? [c.capMetric] : []), ...config.relationships.flatMap(r => [r.sourceMetric, r.targetMetric]), ...config.bounds.flatMap(b => [b.metric, ...(b.maxMetric ? [b.maxMetric] : [])])]);
  if ([...required].some(m => !Number.isFinite(input.baseline[m]))) return unavailable("Недостаточно числовых исходных значений.");
  if (config.relationships.some(r => !Number.isFinite(r.effectCoefficient) || !r.provenance?.note?.trim() || !["demo_calibration", "domain_calibration", "historical_estimate", "configured_assumption"].includes(r.provenance.kind))) return unavailable("Коэффициент без корректного происхождения.");
  const values = { ...input.baseline }, boundsApplied: string[] = [];
  for (const b of config.bounds) if (!Number.isFinite(b.min) || values[b.metric] < b.min || b.maxMetric && values[b.metric] > values[b.maxMetric]) return unavailable("Исходные значения нарушают ограничения.");
  if (c.capMetric && values[c.metric] > values[c.capMetric]) return unavailable("Исходное управление превышает configured cap.");
  values[c.metric] *= 1 + (c.allowedDirection === "increase" ? 1 : -1) * change / 100;
  const requestedUnboundedValue = values[c.metric];
  if (!Number.isFinite(requestedUnboundedValue)) return unavailable("Неограниченное сценарное значение не является конечным числом.");
  if (c.capMetric && values[c.metric] > values[c.capMetric]) { values[c.metric] = values[c.capMetric]; boundsApplied.push(c.metric); }
  const visited = new Set([c.metric]);
  for (const r of config.relationships) {
    if (!visited.has(r.sourceMetric) || visited.has(r.targetMetric)) return unavailable("Модель должна быть упорядоченной цепочкой без циклов.");
    values[r.targetMetric] = input.baseline[r.targetMetric] + (values[r.sourceMetric] - input.baseline[r.sourceMetric]) * r.effectCoefficient;
    for (const b of config.bounds.filter(b => b.metric === r.targetMetric)) {
      const next = Math.max(b.min, Math.min(values[b.metric], b.maxMetric ? values[b.maxMetric] : Infinity));
      if (next !== values[b.metric]) boundsApplied.push(b.metric);
      values[b.metric] = next;
    }
    visited.add(r.targetMetric);
  }
  if (Object.values(values).some(v => !Number.isFinite(v)) || config.bounds.some(b => values[b.metric] < b.min || b.maxMetric && values[b.metric] > values[b.maxMetric])) return unavailable("Сценарий нарушает ограничения.");
  const impacts = config.relationships.map(r => ({ metric: r.targetMetric, baselineValue: input.baseline[r.targetMetric], simulatedValue: values[r.targetMetric], absoluteChange: values[r.targetMetric] - input.baseline[r.targetMetric], ...(input.baseline[r.targetMetric] !== 0 ? { relativeChangePct: (values[r.targetMetric] - input.baseline[r.targetMetric]) / Math.abs(input.baseline[r.targetMetric]) * 100 } : {}) }));
  return { status: "AVAILABLE", domainId: input.domainId, controlMetric: c.metric, baselineValue: input.baseline[c.metric], scenarioValue: values[c.metric], changePct: change,
    requestedChangePct: change, requestedUnboundedValue, boundedScenarioValue: values[c.metric],
    effectiveChangePct: input.baseline[c.metric] === 0 ? null : (values[c.metric] - input.baseline[c.metric]) / Math.abs(input.baseline[c.metric]) * 100,
    ...(c.capMetric && boundsApplied.includes(c.metric) ? { controlBound: { boundMetric: c.capMetric, boundValue: input.baseline[c.capMetric], boundReason: "configured_cap" as const, source: c.capMetric } } : {}),
    impacts, assumptions: structuredClone(config.relationships), bounded: boundsApplied.length > 0, boundsApplied };
}

export type InterventionCandidate = Extract<ScenarioResult, { status: "AVAILABLE" }> & { controlScenarioValue: number; targetValue: number; targetThreshold: number; reachesTarget: boolean };
export type InterventionAnalysis = { status: "TARGET_REACHED" | "TARGET_NOT_REACHED" | "NO_VALID_SCENARIO"; controlMetric?: string; targetMetric?: string; targetThreshold?: number; candidates: InterventionCandidate[]; recommendedCandidate?: InterventionCandidate; rationale: string };
export function analyzeDomainIntervention(input: Omit<ScenarioInput, "changePct">, config = getDomainPack(input.domainId)?.scenario): InterventionAnalysis {
  if (!config || !Number.isFinite(config.intervention.targetThreshold) || config.intervention.metric !== config.control.metric || config.intervention.allowedDirection !== config.control.allowedDirection) return { status: "NO_VALID_SCENARIO", candidates: [], rationale: "Нет допустимой сценарной конфигурации." };
  const candidates: InterventionAnalysis["candidates"] = [];
  const { minChange, maxChange, step } = config.control;
  if (Number.isFinite(step) && step > 0 && Number.isFinite(minChange) && Number.isFinite(maxChange) && (maxChange - minChange) / step <= 100) for (let k = 0; k <= Math.floor((maxChange - minChange) / step); k++) {
    const result = simulateDomainScenario({ ...input, changePct: minChange + k * step }, config);
    if (result.status === "AVAILABLE") {
      const target = result.impacts.find(i => i.metric === config.intervention.targetMetric);
      if (target) candidates.push({ ...result, controlScenarioValue: result.scenarioValue, targetValue: target.simulatedValue, targetThreshold: config.intervention.targetThreshold, reachesTarget: target.simulatedValue <= config.intervention.targetThreshold });
    }
  }
  const recommendedCandidate = candidates.find(c => c.reachesTarget);
  return { status: recommendedCandidate ? "TARGET_REACHED" : candidates.length ? "TARGET_NOT_REACHED" : "NO_VALID_SCENARIO", controlMetric: config.control.metric, targetMetric: config.intervention.targetMetric, targetThreshold: config.intervention.targetThreshold, candidates, ...(recommendedCandidate ? { recommendedCandidate } : {}), rationale: recommendedCandidate ? config.intervention.rationale : "В допустимом диапазоне сценариев целевой уровень не достигнут." };
}
