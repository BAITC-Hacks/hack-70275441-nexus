import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { InvestigationViewModel } from "../../../lib/nexus/report/investigationViewModel";

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const signalIcons: Record<string, string> = { early_signal: "↗", observed_leading_association: "◈", association_without_lead: "↔", not_supported: "○" };
const strengthIcons: Record<string, string> = { very_strong: "▰▰▰▰▰", strong: "▰▰▰▰▱", moderate: "▰▰▰▱▱", weak: "▰▰▱▱▱", very_weak: "▰▱▱▱▱" };
const CHAIN_STAGES = [{ icon: "◆", label: "Данные" }, { icon: "◈", label: "Investigator" }, { icon: "↔", label: "Skeptic" }, { icon: "✓", label: "Проверка" }, { icon: "▣", label: "Готово" }] as const;

/**
 * Purely decorative, always-looping illustration of the fixed Detect → Investigate → Challenge →
 * Validate → Act pipeline (README §5) — never reflects live per-run progress, so it needs no props.
 * A traveling pulse crosses the track and briefly lights each node as it arrives.
 */
export function AgentChain() {
  const trackRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const track = trackRef.current, pulse = pulseRef.current, nodesEl = nodesRef.current;
    if (!track || !pulse || !nodesEl) return;
    const nodes = Array.from(nodesEl.querySelectorAll<HTMLDivElement>("[data-node]"));
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const w = track.offsetWidth;
      const stops = [0, .25, .5, .75, 1].map((p) => p * w);
      const lightNode = (index: number) => {
        const node = nodes[index];
        if (!node) return;
        node.classList.add("lit");
        gsap.fromTo(node.querySelector(".dot"), { scale: 1 }, { scale: 1.22, duration: .16, yoyo: true, repeat: 1, ease: "power1.out" });
        gsap.delayedCall(.55, () => node.classList.remove("lit"));
      };
      const tl = gsap.timeline({ repeat: -1, repeatDelay: .6 });
      tl.set(pulse, { x: stops[0] });
      lightNode(0);
      stops.forEach((stop, index) => {
        if (index === 0) return;
        tl.to(pulse, { x: stop, duration: .68, ease: "power1.inOut", onComplete: () => lightNode(index) });
        if (index < stops.length - 1) tl.to({}, { duration: .18 });
      });
      const onVisibility = () => { document.hidden ? tl.pause() : tl.resume(); };
      document.addEventListener("visibilitychange", onVisibility);
      return () => { document.removeEventListener("visibilitychange", onVisibility); tl.kill(); };
    });
    return () => mm.revert();
  }, { scope: nodesRef });

  return <div className="chain" aria-hidden="true">
    <div className="chain-label"><span>Как устроено расследование внутри</span><b>ЖИВОЙ ПРОЦЕСС</b></div>
    <div className="chain-track" ref={trackRef}><i className="chain-fill" /><span className="chain-pulse" ref={pulseRef} /></div>
    <div className="chain-nodes" ref={nodesRef}>{CHAIN_STAGES.map((stage) => <div className="chain-node" data-node key={stage.label}><span className="dot">{stage.icon}</span><small>{stage.label}</small></div>)}</div>
  </div>;
}

/**
 * A native <details> disclosure (matches the accessible, keyboard-operable pattern already used
 * throughout this file — e.g. InterpretationCard's "Почему этот вывод?") so collapsed content stays
 * correctly hidden from screen readers and out of tab order with zero extra ARIA bookkeeping. GSAP only
 * decorates the reveal moment once the browser has already un-hidden the content; it never controls
 * open/closed state itself.
 */
export function TechnicalDetail({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const details = detailsRef.current, body = bodyRef.current;
    if (!details || !body) return;
    const onToggle = () => {
      if (!details.open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.fromTo(body.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .3, stagger: .05, ease: "power1.out" });
    };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, { scope: detailsRef });

  return <details className="tech-panel" ref={detailsRef}>
    <summary className="tech-toggle">
      <span className="ttxt"><b>Как мы к этому пришли</b><small>Полная техническая раскладка: агенты, доказательства, график и альтернативы</small></span>
      <span className="switch" aria-hidden="true"><i /></span>
    </summary>
    <div className="tech-body" ref={bodyRef}>{children}</div>
  </details>;
}

export function InterpretationCard({ card }: { card: InvestigationViewModel["cards"][number] }) {
  const { interpretation: i, edge } = card;
  return <article className={`panel interpretation-card signal-${card.presentationState}`}>
    <span className="section-kicker"><span className="signal-icon" aria-hidden="true">{signalIcons[card.presentationState]}</span> {card.badge}</span><h3>{i.displayName}</h3>
    <p>{card.headline}</p><dl><div><dt>Сила связи</dt><dd className={`relationship-strength strength-${i.strength ?? "unknown"}`}><span aria-hidden="true">{i.strength ? strengthIcons[i.strength] : "—"}</span> {card.strengthLabel}</dd></div>
      <div><dt>Измеренный лаг</dt><dd>{card.measuredLagLabel}</dd></div>
      <div><dt>Ожидаемый отраслевой лаг</dt><dd>{card.expectedLagLabel}</dd></div></dl>
    <p>{card.significanceLabel}</p><p>{card.priorLabel}</p>
    {!card.early && i.temporal.status === "not_temporally_leading" && <p><strong>Не классифицируется как ранний сигнал.</strong></p>}
    <details><summary>Почему этот вывод? Технические данные</summary>
      <p>{i.explanation}</p><p>Domain prior — контекстная гипотеза, а не доказательство причинности.</p>
      <p>Источник: детерминированный precursor-chain artifact. Metric: {edge.from} → {edge.to}.</p>
      <p>r={edge.correlation}; lag={edge.lagPeriods}; n={edge.n}; p-value={edge.pValue ?? "Нет данных"}; Holm: {i.significance.status}.</p>
      <p>CI: {edge.ci95 ? `[${edge.ci95.lower}, ${edge.ci95.upper}]` : "Нет данных"}.</p>
      {edge.bootstrap && <p>Bootstrap: {edge.bootstrap.stability}; resamples={edge.bootstrap.resamples}; CI=[{edge.bootstrap.ci95.lower}, {edge.bootstrap.ci95.upper}].</p>}
      <p>Все проверенные лаги: {edge.allLags.map(l => `${l.lag}: r=${l.correlation}, p=${l.pValue}, n=${l.n}`).join("; ")}</p>
      {i.limitations.map(l => <p key={l}>{l}</p>)}
    </details>
  </article>;
}

export function DecisionView({ model }: { model: InvestigationViewModel }) {
  const values = model.observed.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const points = model.observed.map(p => `${20 + p.index / Math.max(1, model.observed.at(-1)?.index ?? 1) * 560},${110 - (p.value - min) / Math.max(.001, max - min) * 90}`).join(" ");
  const measuredLeadCards = model.cards.filter(card => card.observedLead);
  return <div className="decision-view">
    <AgentChain />
    <section className="panel decision-summary"><p className="section-kicker">НАБЛЮДАЕМЫЕ ДАННЫЕ</p><h2>{model.targetLabel}</h2>
      {model.headline && <p className="decision-headline">{model.headline}</p>}
      {measuredLeadCards.length > 0 ? <div className="action-box">
        <p className="section-kicker">Что проверить в первую очередь</p>
        <ol>{measuredLeadCards.slice(0, 3).map((card, index) => <li key={card.interpretation.metric} className="a-item">
          <span className="rank">{index + 1}</span>
          <div><b>{card.interpretation.displayName}</b><p>Опережение {card.measuredLagLabel} · {card.significanceLabel.toLowerCase()}</p></div>
        </li>)}</ol>
      </div> : <p className="caveat">{model.recommendation}</p>}
      <div className="decision-stats"><div><span>Текущее значение</span><strong>{model.latest ? `${number(model.latest.value)} ${model.targetUnit ?? ""}` : "Нет данных"}</strong></div>
        <div><span>Связи с измеренным лагом</span><strong>{measuredLeadCards.length}</strong></div>
        <div><span>Согласованность свидетельств</span><strong>{model.associationLabel}</strong><small>{model.associationIndexLabel}</small></div></div>
      <p className="caveat">Не является вероятностью события или калиброванной уверенностью. Причинность не установлена.</p>
    </section>
    <TechnicalDetail>
    {model.story && <section className="panel jury-investigation" aria-labelledby="jury-investigation-title">
      <p className="section-kicker">ЧТО ОБНАРУЖИЛ NEXUS</p><h2 id="jury-investigation-title">Как система проверила рабочую гипотезу</h2>
      <div className="jury-story-grid">
        <article><span>ГИПОТЕЗА INVESTIGATOR</span><blockquote>{model.story.investigator.hypothesis}</blockquote><p><strong>Альтернативное объяснение:</strong> {model.story.investigator.alternative}</p><small>{model.story.investigator.source === "LLM" ? "ИИ-агент" : "Резервный режим"} · интерпретация, не числовой источник</small></article>
        <article className="evidence-authority" data-authority="deterministic"><span>ДЕТЕРМИНИРОВАННЫЙ EVIDENCE</span>{model.story.relationships.map(item => <div key={item.metric}><strong>{item.label}</strong><p>{item.headline} {item.significance}</p></div>)}
          {model.story.investigator.evidence.map(item => <div key={item.id}><strong>{item.id} · {item.variables.join(" ↔ ") || item.tool}</strong><p>{item.summary}</p></div>)}</article>
        <article className="skeptic-story"><span>НЕЗАВИСИМАЯ ПРОВЕРКА SKEPTIC</span><h3>{model.story.skeptic.status}</h3><small className="skeptic-status-note">Результат попытки Skeptic независимо оспорить гипотезу — не итоговый статус расследования (см. «Validator» выше).</small><blockquote>{model.story.skeptic.challenge}</blockquote>
          {model.story.skeptic.alternatives.length > 0 && <ul>{model.story.skeptic.alternatives.map(item => <li key={item}>{item}</li>)}</ul>}
          {model.story.skeptic.evidence.map(item => <small key={item.id}>{item.id} · {item.summary}</small>)}</article>
      </div>
      <div className="jury-conclusion-grid">
        <article className="conclusion-primary"><span>ВЫВОД</span><p>{model.story.conclusion}</p></article>
        <article><span>НЕОПРЕДЕЛЁННОСТЬ</span><ul>{model.story.uncertainty.map(item => <li key={item}>{item}</li>)}</ul></article>
        <article><span>СЛЕДУЮЩАЯ ПРОВЕРКА ОПЕРАТОРА</span><ol>{model.story.nextSteps.slice(0, 2).map(item => <li key={item}>{item}</li>)}</ol></article>
      </div>
    </section>}
    <section className="panel"><p className="section-kicker">КАК РАЗВИВАЛАСЬ СИТУАЦИЯ</p><h2>Изменение во времени</h2>
      {model.observed.length > 0 ? <><svg viewBox="0 0 600 130" role="img" aria-label={`${model.targetLabel}: ${model.first?.value} в начале, ${model.latest?.value} в конце`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" /></svg>
        <p>{model.first?.period.slice(0, 10)}: {number(model.first!.value)} → {model.latest?.period.slice(0, 10)}: {number(model.latest!.value)}. Фактические наблюдения, не прогноз.</p>
        <details><summary>Исходные значения временного ряда</summary><p>Источник: загруженный dataset; target: {model.targetLabel}.</p><ul>{model.observed.map(p => <li key={p.index}>{p.period}: {number(p.value)}</li>)}</ul></details></> : <p>Временной ряд отсутствует.</p>}
      {model.ordering.length > 0 && <><h3>Порядок изменений, обнаруженный инструментом</h3><ol>{model.ordering.map(s => <li key={s.row}>Строка {s.row}: {s.labels.join("; ")}</li>)}</ol><p>Это пороговые изменения по порядку строк. Они не устанавливают причинную цепочку.</p></>}
    </section>
    <section><p className="section-kicker">РАННИЕ СИГНАЛЫ И КОНТРОЛЬНЫЕ СВЯЗИ</p><h2>Что подтверждает проверку</h2>
      <p>Каждая карточка — отдельная связь с целевым показателем; последовательность между сигналами не предполагается.</p>
      <div className="interpretation-grid">{model.cards.map(card => <InterpretationCard key={card.interpretation.metric} card={card} />)}</div>
    </section>
    <section className="panel panel-secondary"><p className="section-kicker">ПРОВЕРКА АЛЬТЕРНАТИВ</p><h3>Альтернативные объяснения</h3><p>{model.alternatives.message}</p>
      <ul>{model.alternatives.factors.map(f => <li key={f.label}>{f.label}: {f.status}</li>)}</ul>
      <p>Проверенные факторы не исключают другие объяснения изменения целевого показателя.</p>
    </section>
    {!model.scenario && <section className="panel panel-secondary"><p className="section-kicker">СЦЕНАРНЫЙ РАСЧЁТ</p><h3>Наблюдения и моделирование</h3><p>В этом результате нет доступной сценарной конфигурации. График и связи выше — наблюдаемые данные, не прогноз.</p></section>}
    </TechnicalDetail>
  </div>;
}
