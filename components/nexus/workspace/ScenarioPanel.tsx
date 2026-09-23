import { simulateDomainScenario, analyzeDomainIntervention } from "../../../lib/engine/domainSimulation";
import type { InvestigationViewModel } from "../../../lib/nexus/report/investigationViewModel";
import { displayLabel } from "../../../lib/nexus/report/displayLabels";
import { formatLag } from "../../../lib/nexus/report/timeUnits";

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
export function ScenarioPanel({ scenario, changePct, onChange }: { scenario: NonNullable<InvestigationViewModel["scenario"]>; changePct: number; onChange: (value: number) => void }) {
  const result = simulateDomainScenario({ ...scenario.input, changePct });
  const intervention = analyzeDomainIntervention(scenario.input);
  const c = scenario.config.control;
  return <div className="decision-view scenario-view" data-layer="SIMULATION">
    <section className="panel"><p className="section-kicker">МОДЕЛЬНЫЙ СЦЕНАРИЙ</p><h2>{scenario.config.labelRu}</h2>
      <p>Это расчёт сценарной модели, а не наблюдаемый результат и не прогноз.</p>
      <label htmlFor="scenario-change">Изменение: {changePct}%</label><input id="scenario-change" type="range" min={c.minChange} max={c.maxChange} step={c.step} value={changePct} onChange={event => onChange(Number(event.target.value))} />
      {result.status === "AVAILABLE" ? <><p>Текущее значение: {number(result.baselineValue)} → сценарное значение: {number(result.scenarioValue)} {scenario.units[c.metric]}.</p>
        <h3>Модельный эффект</h3><dl>{result.impacts.map(i => <div key={i.metric}><dt>{displayLabel(i.metric)}</dt><dd>Наблюдаемое: {number(i.baselineValue)} → модельное: {number(i.simulatedValue)} {scenario.units[i.metric]}</dd></div>)}</dl>
        {result.bounded && <p>Применены ограничения модели: {result.boundsApplied.map(displayLabel).join("; ")}.</p>}
        {result.controlBound && <div className="scenario-cap-explanation">
          <p>Выбранный сценарий: {result.requestedChangePct.toLocaleString("ru-RU", { maximumFractionDigits: 2, signDisplay: "exceptZero" })}%.</p>
          <p>Расчётное значение без ограничения: {number(result.requestedUnboundedValue)} {scenario.units[c.metric]}.</p>
          <p>Применён предел: {displayLabel(result.controlBound.boundMetric)} — {number(result.controlBound.boundValue)} {scenario.units[c.metric]}.</p>
          <p>Фактическое значение в модели: {number(result.boundedScenarioValue)} {scenario.units[c.metric]}. Фактическое изменение в модели: {result.effectiveChangePct === null ? "не определено" : `≈ ${result.effectiveChangePct.toLocaleString("ru-RU", { maximumFractionDigits: 1, signDisplay: "exceptZero" })}%`}.</p>
        </div>}
        <details><summary>Модельные допущения и происхождение коэффициентов</summary>{result.assumptions.map(r => <p key={r.targetMetric}>{displayLabel(r.sourceMetric)} → {displayLabel(r.targetMetric)}: {r.effectCoefficient}; лаг модели: {r.expectedLagPeriods === undefined ? "не задан" : formatLag(r.expectedLagPeriods, scenario.cadence)}. {r.provenance.kind}: {r.provenance.note}</p>)}</details></> : <p>Сценарий недоступен: {result.reason}</p>}
    </section>
    <section className="panel" data-layer="INTERVENTION_ANALYSIS"><p className="section-kicker">МОДЕЛЬНЫЙ ВАРИАНТ ВМЕШАТЕЛЬСТВА</p><h2>Вариант для операционной проверки</h2>
      {intervention.recommendedCandidate ? <><p>Минимальное рассмотренное изменение, достигающее заданного порога: {intervention.recommendedCandidate.changePct}%. Порог: {intervention.targetThreshold} {scenario.units[intervention.targetMetric ?? ""]}.</p>{intervention.recommendedCandidate.impacts.filter(i => i.metric === intervention.targetMetric).map(i => <p key={i.metric}>{displayLabel(i.metric)}: {number(i.baselineValue)} → {number(i.simulatedValue)} {scenario.units[i.metric]}.</p>)}</> : <p>{intervention.rationale}</p>}
      <p>Это сценарная рекомендация для операционной проверки. Она не является доказанно оптимальным решением. Рекомендация не означает выполнение вмешательства.</p>
    </section>
  </div>;
}
