"use client";
import { AgentRuntimeTrace, DELAYED_AGENT_MESSAGE, runtimeSourceLabel, runtimeFallbackMessage } from "./AgentRuntimeTrace";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { buildCrossSectionalBusinessSummary } from "@/lib/nexus/report/crossSectionalBusinessSummary";
import { buildEventTransactionBusinessSummary } from "@/lib/nexus/report/eventTransactionBusinessSummary";
import { formatBoundedIds } from "@/lib/nexus/report/boundedList";
import { profileDataset } from "@/lib/nexus/ingestion/profileDataset";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import { normalizeTabularRows } from "@/lib/nexus/ingestion/normalizeTabularRows";
import { csvRows } from "@/lib/nexus/ingestion/csv";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { InvestigatorRun, ValidatorRun } from "@/lib/types";
import type { AgenticResult, InvestigationProgress, InvestigationStage } from "@/lib/nexus/agentic/types";
import { DEMO_SCENARIOS, DOMAINS, findScenario, type Domain } from "@/lib/nexus/demo/scenarios";
import { displayDomainLabel, displayLabel } from "@/lib/nexus/report/displayLabels";
import { classifyCorrelationStrength, strengthText } from "@/lib/nexus/report/interpretation";
import type { CrossSectionalAssociation } from "@/lib/nexus/crossSectional/types";
import { buildInvestigationReportModel } from "@/lib/nexus/report/reportModel";
import { admitInvestigation } from "@/lib/nexus/universal/admission";
import { findColumnByRole } from "@/lib/nexus/universal/headers";
import type { CrossSectionalWorkflowResult } from "@/lib/nexus/crossSectional/types";
import type { EventTransactionWorkflowResult } from "@/lib/nexus/eventTransaction/types";
import { getExportDecisionAction } from "@/lib/nexus/action/exportDecision";
import type { ActionRecord } from "@/lib/nexus/action/types";
import type { TimeSeriesActionResult } from "@/lib/nexus/action/proposeAction";
import { DecisionView, AgentChain, TechnicalDetail } from "./DecisionView";
import { ScenarioPanel } from "./ScenarioPanel";
import { buildScenarioReviewPackage, verifyScenarioReviewPackage } from "@/lib/nexus/report/scenarioPackage";
import { buildInvestigationViewModel } from "@/lib/nexus/report/investigationViewModel";
import { getDomainPack } from "@/lib/nexus/domains/registry";
import { resolveDatasetSchema, normalizeDatasetSchema } from "@/lib/nexus/domains/resolution";
import { SchemaResolutionPanel } from "./SchemaResolutionPanel";

type Step = "upload" | "map" | "review" | "running" | "results";
type TimeSeriesResults = TimeSeriesActionResult & { analysis: GenericAnalysis; investigator: InvestigatorRun; validator: ValidatorRun; agentic: AgenticResult };
type Results = TimeSeriesResults | CrossSectionalWorkflowResult | EventTransactionWorkflowResult;
const stages = ["ДАННЫЕ", "НАСТРОЙКИ", "РАССЛЕДОВАНИЕ", "РЕЗУЛЬТАТ"];
const MIN_ROWS = 3;

/** Raw runtime stages collapse into the few phases a person actually cares about. */
const STAGE_LABELS: Record<InvestigationStage, string> = {
  DATA_ACQUIRED: "НАБЛЮДЕНИЕ ДАННЫХ",
  SIGNALS_DETECTED: "ИССЛЕДОВАНИЕ СИГНАЛОВ",
  INVESTIGATOR_SELECTING_CHECK: "ИССЛЕДОВАНИЕ СИГНАЛОВ",
  INVESTIGATOR_TOOL_EXECUTING: "СБОР ДОКАЗАТЕЛЬСТВ",
  HYPOTHESIS_FORMED: "ФОРМИРОВАНИЕ ГИПОТЕЗЫ",
  SKEPTIC_CHALLENGING: "ПРОВЕРКА SKEPTIC",
  SKEPTIC_TOOL_EXECUTING: "ПРОВЕРКА SKEPTIC",
  HYPOTHESIS_REVISED: "ПЕРЕСМОТР ГИПОТЕЗЫ",
  VERDICT_READY: "ЗАВЕРШЕНО",
};

export function InvestigationWorkspace() {
  const input = useRef<HTMLInputElement>(null); const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("upload"); const [dataset, setDataset] = useState<UploadedDataset>(); const [error, setError] = useState("");
  const [sheetChoice, setSheetChoice] = useState<{ name: string; workbook: XLSX.WorkBook; sheet: string }>();
  const [objective, setObjective] = useState(""); const [domain, setDomain] = useState<Domain>("AUTO / UNKNOWN"); const [date, setDate] = useState(""); const [target, setTarget] = useState(""); const [signals, setSignals] = useState<string[]>([]);
  const [results, setResults] = useState<Results>(); const [progress, setProgress] = useState<InvestigationProgress[]>([]); const [responseDelayed, setResponseDelayed] = useState(false);
  const [sourceDataset, setSourceDataset] = useState<UploadedDataset>();
  const schema = useMemo(() => dataset ? resolveDatasetSchema((sourceDataset ?? dataset).columns, domain === "AUTO / UNKNOWN" ? undefined : { domainId: domain }) : undefined, [sourceDataset, dataset, domain]);
  /** Registry label when the selected domain has one (e.g. FinTech's cost_of_funds); the existing generic fallback otherwise. */
  const columnLabel = (column: string) => displayDomainLabel(column, domain);
  const applySchema = () => {
    if (!dataset || !schema?.domain.selectedDomainId) return;
    try {
      const original = sourceDataset ?? dataset, normalized = normalizeDatasetSchema(original, schema);
      const rename = (column: string) => {
        const sourceColumn = sourceDataset?.columns[dataset.columns.indexOf(column)] ?? column;
        return schema.columns.find(c => c.originalColumn === sourceColumn && c.status === "MATCHED")?.canonicalMetric ?? sourceColumn;
      };
      setSourceDataset(original); setDataset(normalized); setDomain(schema.domain.selectedDomainId);
      setDate(rename(date)); setTarget(rename(target) || getDomainPack(schema.domain.selectedDomainId)?.outcomeMetrics?.find(m => normalized.columns.includes(m)) || ""); setSignals(signals.map(rename)); setError("");
    } catch { setError("Mapping не применён: конфликт выходных колонок."); }
  };
  const [preflight, setPreflight] = useState<{ datasetAvailable: boolean; liveAgentsAvailable: boolean; toolRegistryInitialized: boolean; llmBudget: number; toolBudget: number }>();
  const profile = useMemo(() => dataset ? profileDataset(dataset) : undefined, [dataset]);
  const routeTaskId = searchParams.get("task") ?? searchParams.get("demo") ?? "generic";
  const routeDecision = useMemo(() => dataset ? admitInvestigation({ dataset, signals, taskId: routeTaskId, intent: "INVESTIGATE", mapping: { date: date || undefined, target: target || undefined } }) : undefined, [dataset, signals, routeTaskId, date, target]);
  const isTimeSeries = routeDecision?.shape.tag === "TIME_SERIES";
  const isCrossSectional = routeDecision?.workflowId === "cross-sectional-investigation";
  const isEventTransaction = routeDecision?.workflowId === "event-transaction-investigation";
  const timeline = useMemo(() => { const phases = new Map<string, { detail: string; source: InvestigationProgress["source"] }>(); progress.forEach((item) => phases.set(STAGE_LABELS[item.stage], { detail: item.detail, source: item.source })); return [...phases.entries()]; }, [progress]);

  useEffect(() => { void fetch("/api/investigate/preflight").then((response) => response.ok ? response.json() : undefined).then(setPreflight).catch(() => setPreflight(undefined)); }, []);
  useEffect(() => { const stated = searchParams.get("objective"); if (stated) setObjective((current) => current || stated); }, [searchParams]);
  useEffect(() => {
    const scenario = findScenario(searchParams.get("demo"));
    if (!scenario || dataset) return;
    const next = scenario.dataset(); const nextProfile = profileDataset(next);
    setDataset(next); setDate(nextProfile.dateColumns[0] ?? "");
    setTarget(scenario.target); setSignals(nextProfile.numericColumns.filter((column) => column !== scenario.target).slice(0, 6));
    setDomain(scenario.domain); setObjective((current) => current || scenario.objective); setStep("review");
  }, [dataset, searchParams]);

  const load = (name: string, rows: unknown[][]) => {
    const parsed = normalizeTabularRows(rows);
    if (!parsed.length) return setError("В этом файле нет пригодных строк. Убедитесь, что первая строка содержит названия колонок, а данные идут ниже.");
    const columns = Object.keys(parsed[0]); const next = { name, rows: parsed, columns }; const nextProfile = profileDataset(next);
    const eventShape = admitInvestigation({ dataset: next, signals: nextProfile.numericColumns, taskId: routeTaskId, intent: "INVESTIGATE" }).shape.tag === "EVENT_TRANSACTION";
    if (!nextProfile.numericColumns.length && !eventShape) return setError("NEXUS не нашёл числовых колонок в этом файле. Выберите набор данных хотя бы с одним измеримым показателем или корректным журналом событий.");
    if (parsed.length < MIN_ROWS) return setError(`NEXUS требуется минимум ${MIN_ROWS} записи для ограниченного расследования. В этом файле их ${parsed.length}.`);
    setSourceDataset(undefined); setDataset(next); setDate(nextProfile.dateColumns[0] ?? ""); setSignals(nextProfile.numericColumns.slice(0, 4));
    setTarget(findColumnByRole(next.columns, "TARGET_NUMERIC") ?? findColumnByRole(next.columns, "TARGET_CATEGORY") ?? next.columns.find((column) => /target|outcome|failure|flag|risk|gap/i.test(column)) ?? ""); setError("");
  };
  const handleFile = async (file?: File) => { if (!file) return; if (file.size > 10 * 1024 * 1024) return setError("Файл больше 10 МБ. Оставьте только колонки и период, которые нужно исследовать."); const extension = file.name.split(".").pop()?.toLowerCase(); setSheetChoice(undefined); try { if (extension === "csv") load(file.name, csvRows(await file.text())); else if (extension === "xlsx" || extension === "xls") { const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }); const sheet = workbook.SheetNames[0]; if (!sheet) throw new Error(); if (workbook.SheetNames.length > 1) setSheetChoice({ name: file.name, workbook, sheet }); load(file.name, XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, raw: true }) as unknown[][]); } else setError("NEXUS читает файлы CSV и Excel. Экспортируйте эти данные в .csv или .xlsx и попробуйте снова."); } catch { setError("NEXUS не смог безопасно прочитать этот файл. Возможно, он повреждён или защищён паролем."); } };
  const selectSheet = (sheet: string) => { if (!sheetChoice) return; setSheetChoice({ ...sheetChoice, sheet }); load(sheetChoice.name, XLSX.utils.sheet_to_json(sheetChoice.workbook.Sheets[sheet], { header: 1, raw: true }) as unknown[][]); };
  const loadScenario = (id: string) => { const scenario = findScenario(id); if (!scenario) return; const next = scenario.dataset(); const nextProfile = profileDataset(next); setSourceDataset(undefined); setDataset(next); setDate(nextProfile.dateColumns[0] ?? ""); setTarget(scenario.target); setSignals(nextProfile.numericColumns.filter((column) => column !== scenario.target).slice(0, 6)); setDomain(scenario.domain); setObjective((current) => current || scenario.objective); setError(""); setSheetChoice(undefined); };

  const run = async () => {
    if (!dataset || !isEventTransaction && !signals.length) return setError("Выберите хотя бы один сигнал перед началом расследования.");
    setStep("running"); setError(""); setProgress([]); setResponseDelayed(false);
    let delayTimer: number | undefined;
    try {
      const response = await fetch("/api/investigate", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ dataset, signals, domain, objective, taskId: routeTaskId, intent: "INVESTIGATE", mapping: { date, target } }) });
      if (!response.ok) { const failure = await response.json().catch(() => undefined); throw new Error(failure?.error ?? "NEXUS не смог начать это расследование."); }
      if (!response.body) throw new Error("Поток расследования завершился, не начавшись. Попробуйте запустить снова.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", terminalResult = false;
      const receive = (chunk: string) => {
        const eventType = chunk.match(/^event: (.+)$/m)?.[1]; const payload = chunk.match(/^data: (.+)$/m)?.[1]; if (!eventType || !payload) return;
        const message = JSON.parse(payload) as { kind?: Results["kind"]; error?: string; stage?: InvestigationProgress["stage"]; source?: InvestigationProgress["source"]; detail?: string; analysis?: GenericAnalysis; investigator?: InvestigatorRun; validator?: ValidatorRun; agentic?: AgenticResult; artifact?: CrossSectionalWorkflowResult["artifact"] | EventTransactionWorkflowResult["artifact"] | TimeSeriesActionResult["artifact"]; validation?: CrossSectionalWorkflowResult["validation"] | EventTransactionWorkflowResult["validation"] | TimeSeriesActionResult["validation"] };
        if (eventType === "progress" && message.stage && message.source && message.detail) {
          setProgress((current) => [...current.filter((item) => item.stage !== message.stage), { stage: message.stage!, source: message.source!, detail: message.detail! }]);
          if (message.stage === "INVESTIGATOR_SELECTING_CHECK" || message.stage === "SKEPTIC_CHALLENGING") { window.clearTimeout(delayTimer); delayTimer = window.setTimeout(() => setResponseDelayed(true), 12_000); } else { window.clearTimeout(delayTimer); setResponseDelayed(false); }
        }
        if (eventType === "result" && message.kind === "CROSS_SECTIONAL" && message.artifact && message.validation) { window.clearTimeout(delayTimer); terminalResult = true; setResults({ kind: "CROSS_SECTIONAL", artifact: message.artifact as CrossSectionalWorkflowResult["artifact"], validation: message.validation as CrossSectionalWorkflowResult["validation"] }); setStep("results"); }
        if (eventType === "result" && message.kind === "EVENT_TRANSACTION" && message.artifact && message.validation) { window.clearTimeout(delayTimer); terminalResult = true; setResults({ kind: "EVENT_TRANSACTION", artifact: message.artifact as EventTransactionWorkflowResult["artifact"], validation: message.validation as EventTransactionWorkflowResult["validation"] }); setStep("results"); }
        if (eventType === "result" && message.kind === "TIME_SERIES" && message.artifact && message.validation && message.analysis && message.investigator && message.validator && message.agentic) { window.clearTimeout(delayTimer); terminalResult = true; setResults({ kind: "TIME_SERIES", artifact: message.artifact as TimeSeriesActionResult["artifact"], validation: message.validation as TimeSeriesActionResult["validation"], analysis: message.analysis, investigator: message.investigator, validator: message.validator, agentic: message.agentic }); setStep("results"); }
        if (eventType === "error") throw new Error(message.error ?? "NEXUS остановил это расследование, чтобы не сообщать небезопасный результат.");
      };
      while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); let boundary = buffer.indexOf("\n\n"); while (boundary >= 0) { receive(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); boundary = buffer.indexOf("\n\n"); } if (done) break; }
      if (!terminalResult) throw new Error("Поток расследования завершился без результата. Попробуйте запустить снова.");
    } catch (runError) { setError(runError instanceof Error ? runError.message : "NEXUS не смог завершить это расследование."); setStep("review"); } finally { window.clearTimeout(delayTimer); }
  };
  const reset = () => { setSourceDataset(undefined); setDataset(undefined); setResults(undefined); setStep("upload"); setError(""); setSheetChoice(undefined); setSignals([]); setObjective(""); };
  const activeStep = step === "upload" ? 0 : step === "map" ? 1 : step === "review" ? 1 : step === "running" ? 2 : 3;

  return <main className="workspace-shell">
    <header className="workspace-header">
      <a className="brand" href="/"><span className="brand-mark">N</span><div><strong>NEXUS</strong><small>Автономная система расследования рисков</small></div></a>
      <nav className="workspace-nav"><a href="/">← КОМАНДНЫЙ ЦЕНТР</a><span>РАССЛЕДОВАНИЕ</span></nav>
    </header>

    {objective && step !== "results" && <p className="objective-banner"><span>ЦЕЛЬ РАССЛЕДОВАНИЯ</span>{objective}</p>}

    <nav className="workspace-steps" aria-label="Ход расследования">{stages.map((item, index) => <span className={index < activeStep ? "completed" : index === activeStep ? "current" : "upcoming"} aria-current={index === activeStep ? "step" : undefined} key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}</span>)}</nav>

    {step === "upload" && <section className="workspace-section upload-layout">
      <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFile(event.dataTransfer.files[0]); }}>
        <p className="section-kicker">КАКИЕ ДАННЫЕ ИСПОЛЬЗОВАТЬ?</p><h2>Покажите систему, которую нужно исследовать.</h2>
        <p>Перетащите сюда файл CSV или Excel. Файлы обрабатываются временно, в рамках вашей браузерной сессии, и никогда не сохраняются.</p>
        <button onClick={() => input.current?.click()}>ВЫБРАТЬ ФАЙЛ →</button>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void handleFile(event.target.files?.[0])} hidden />
      </div>
      <aside className="adapter-notice">
        {DEMO_SCENARIOS.some((scenario) => scenario.listed) && <>
          <span>ИЛИ НАЧНИТЕ С ПОДГОТОВЛЕННОГО ДЕЛА</span>
          <p>Подготовленные кейсы — синтетические наборы данных. Они проходят точно тот же путь расследования, что и ваши данные — ничего в них не вычислено заранее.</p>
          {DEMO_SCENARIOS.filter((scenario) => scenario.listed).map((scenario) => <button className="text-button" key={scenario.id} onClick={() => loadScenario(scenario.id)}>{scenario.title.toUpperCase()} →</button>)}
        </>}
        {preflight && <small className={preflight.liveAgentsAvailable ? "preflight-ok" : "preflight-fallback"}>{preflight.datasetAvailable && preflight.toolRegistryInitialized ? preflight.liveAgentsAvailable ? `ЖИВЫЕ АГЕНТЫ ГОТОВЫ / БЮДЖЕТ: ${preflight.llmBudget} LLM + ${preflight.toolBudget} ИНСТРУМЕНТОВ` : "ЖИВЫЕ АГЕНТЫ НЕДОСТУПНЫ — NEXUS ЗАПУСТИТСЯ В БЕЗОПАСНОМ ДЕТЕРМИНИРОВАННОМ РЕЗЕРВНОМ РЕЖИМЕ" : "ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА СИСТЕМЫ НЕДОСТУПНА"}</small>}
      </aside>
      {error && <p className="workspace-error">{error}</p>}
      {sheetChoice && <label className="method-warning sheet-picker">В файле {sheetChoice.workbook.SheetNames.length} листов. Выберите, какой анализировать:
        <select value={sheetChoice.sheet} onChange={(event) => selectSheet(event.target.value)}>
          {sheetChoice.workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>}
      {dataset && profile && <DatasetReceived dataset={dataset} profile={profile} crossSectional={isCrossSectional} eventTransaction={isEventTransaction} timeSeries={isTimeSeries} onContinue={() => setStep("map")} />}
    </section>}

    {step === "map" && dataset && profile && <section className="workspace-section mapping-workspace">
      <div className="configuration-main">
        <p className="section-kicker">ЧТО ВЫ ХОТИТЕ РАССЛЕДОВАТЬ?</p><h2>Определите цель.</h2>
        <label className="objective-field workspace-objective"><strong>ЦЕЛЬ РАССЛЕДОВАНИЯ</strong><textarea value={objective} rows={2} placeholder="Исследовать, почему увеличивается риск отставания от графика." onChange={(event) => setObjective(event.target.value)} /><small>Передаётся Investigator и Skeptic как их цель. Они сами выбирают инструменты; все цифры остаются детерминированными.</small></label>
        <div className="mapping-grid">
          {isEventTransaction ? <label>СМЫСЛ СТРОКИ<strong>ОДНО СОБЫТИЕ/ТРАНЗАКЦИЯ НА СТРОКУ</strong><small>Использует время события для ограниченной группировки; лаг и precursor-анализ не применяются.</small></label> : isCrossSectional ? <label>СМЫСЛ СТРОКИ<strong>ОДНА СУЩНОСТЬ НА СТРОКУ</strong><small>Временной порядок и анализ лагов не применяются.</small></label> : <label>КОЛОНКА ДАТЫ/ВРЕМЕНИ<select value={date} onChange={(event) => setDate(event.target.value)}><option value="">Не выбрано</option>{dataset.columns.map((column) => <option key={column} value={column}>{columnLabel(column)}</option>)}</select></label>}
          {!isEventTransaction && <label>ПОКАЗАТЕЛЬ ДЛЯ ОБЪЯСНЕНИЯ <small>НЕОБЯЗАТЕЛЬНАЯ ЦЕЛЬ</small><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Использовать безопасное сопоставление или только описательный анализ</option>{dataset.columns.map((column) => <option key={column} value={column}>{columnLabel(column)}</option>)}</select></label>}
          <label>ДОМЕН<select value={domain} onChange={(event) => setDomain(event.target.value as Domain)}>{DOMAINS.map((item) => <option key={item}>{item}</option>)}</select><small>Общие статистические инструменты — только описательный анализ.</small></label>
        </div>
        {schema && <SchemaResolutionPanel schema={schema} canApply={Boolean(isTimeSeries)} onApply={applySchema} />}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        {!isEventTransaction && <fieldset className="signal-selection"><legend>{isTimeSeries ? "ОТСЛЕЖИВАЕМЫЕ СИГНАЛЫ" : "ЧИСЛОВЫЕ ПОКАЗАТЕЛИ ДЛЯ ПРОВЕРКИ"} <span>{signals.length} ВЫБРАНО</span></legend><div>{profile.numericColumns.map((column) => <label className={`signal-card ${signals.includes(column) ? "selected" : ""}`} key={column}><input type="checkbox" checked={signals.includes(column)} onChange={() => setSignals((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column])} /><b>{signals.includes(column) ? "✓" : "+"}</b><strong>{columnLabel(column)}</strong><small>ЧИСЛО</small></label>)}</div></fieldset>}
        <Preview dataset={dataset} domain={domain} />
        <div className="workspace-actions"><button className="secondary" onClick={() => setStep("upload")}>НАЗАД</button><button disabled={!isEventTransaction && !signals.length} onClick={() => setStep("review")}>ДАЛЕЕ →</button></div>
      </div>
      <DatasetSidebar dataset={dataset} profile={profile} crossSectional={isCrossSectional} eventTransaction={isEventTransaction} timeSeries={isTimeSeries} />
    </section>}

    {step === "review" && dataset && profile && <section className="workspace-section review">
      <p className="section-kicker">ГОТОВО К РАССЛЕДОВАНИЮ</p><h2>Подтвердите, что сделает NEXUS.</h2>
      <div className="review-grid">
        <div><span>ЦЕЛЬ</span><strong>{objective || "Не указана — NEXUS проведёт описательное расследование."}</strong></div>
        <div><span>НАБОР ДАННЫХ</span><strong>{dataset.name}</strong></div>
        <div><span>НАБЛЮДЕНИЙ</span><strong>{profile.rowCount.toLocaleString()}</strong></div>
        <div><span>{isTimeSeries ? "ПЕРИОД" : "СМЫСЛ СТРОКИ"}</span><strong>{isEventTransaction ? "Одно событие/транзакция на строку" : isCrossSectional ? "Одна сущность на строку" : isTimeSeries ? profile.dateRange ? `${profile.dateRange.first} → ${profile.dateRange.last}` : "Не определён" : "Структура требует уточнения"}</strong></div>
        <div><span>{isEventTransaction ? "АНАЛИЗ СОБЫТИЙ" : isTimeSeries ? "СИГНАЛЫ" : "ЧИСЛОВЫЕ ПОКАЗАТЕЛИ"}</span><strong>{isEventTransaction ? "Типы, сущности, время, повторы и значения" : signals.map(columnLabel).join(", ")}</strong></div>
        <div><span>ЦЕЛЕВОЙ ПОКАЗАТЕЛЬ</span><strong>{isEventTransaction ? "Не используется" : target ? columnLabel(target) : isCrossSectional ? "Безопасный алиас или только описательный анализ" : isTimeSeries ? "Самый аномальный сигнал" : "Не применяется до подтверждения структуры"}</strong></div>
      </div>
      <p className="method-warning">{isEventTransaction ? "NEXUS определил набор как журнал событий/транзакций. Каждая строка представляет отдельное событие. Расследование будет анализировать частоты, активность сущностей, временные скопления, повторения и необычные последовательности." : isCrossSectional ? "Набор определён как поперечные данные: каждая строка представляет отдельного клиента. NEXUS будет исследовать распределения, сегменты, ассоциации и факторы риска без временных лагов." : isTimeSeries ? "NEXUS рассчитает описательную статистику, лаговые связи и выбросы по этим данным, а затем оспорит собственное объяснение. Причинность не устанавливается, прогноз не строится." : "Смысл строки не установлен. Уточните идентификаторы, поля времени и действия или структуру наблюдений перед расследованием."}</p>
      {error && <p className="workspace-error">{error}</p>}
      <div className="workspace-actions"><button className="secondary" onClick={() => setStep("map")}>ИЗМЕНИТЬ</button><button onClick={() => void run()}>{isCrossSectional || isEventTransaction ? "НАЧАТЬ РАССЛЕДОВАНИЕ →" : "НАЧАТЬ РАССЛЕДОВАНИЕ →"}</button></div>
    </section>}

    {step === "running" && <section className="workspace-section progress">
      <p className="section-kicker">РАССЛЕДОВАНИЕ ВЫПОЛНЯЕТСЯ</p><h2>{objective || "Идёт по реальному пути выполнения."}</h2>
      <p className="progress-boundary">NEXUS выбирает детерминированные инструменты, собирает доказательства, формирует рабочее объяснение и оспаривает его. Каждый этап ниже появляется только тогда, когда он реально выполняется.</p>
      <ol className="progress-timeline">{timeline.map(([label, item], index) => <li className={index === timeline.length - 1 ? "current" : "done"} key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{label}</strong><small>{item.detail}</small></div><b className={`source-${item.source.toLowerCase()}`} translate="no">{runtimeSourceLabel(item.source)}</b></li>)}</ol>
      {responseDelayed && <p className="response-delayed">{DELAYED_AGENT_MESSAGE}</p>}
      {progress.some((item) => item.source === "FALLBACK") && <p className="response-fallback">{runtimeFallbackMessage()}</p>}
    </section>}

    {step === "results" && results && dataset && (results.kind === "EVENT_TRANSACTION" ? <EventTransactionResultsView dataset={dataset} results={results} objective={objective} onEdit={() => setStep("map")} onReset={reset} /> : results.kind === "CROSS_SECTIONAL" ? <CrossSectionalResultsView dataset={dataset} results={results} objective={objective} onEdit={() => setStep("map")} onReset={reset} /> : <ResultsView domainId={domain.toLowerCase()} dataset={dataset} results={results} objective={objective} onEdit={() => setStep("map")} onReset={reset} />)}
  </main>;
}

function DatasetReceived({ dataset, profile, crossSectional, eventTransaction, timeSeries, onContinue }: { dataset: UploadedDataset; profile: ReturnType<typeof profileDataset>; crossSectional: boolean; eventTransaction: boolean; timeSeries: boolean; onContinue: () => void }) { return <section className="received acquired"><p className="section-kicker">ДАННЫЕ ПОЛУЧЕНЫ</p><h2>{dataset.name}</h2><div><strong>{profile.rowCount.toLocaleString()} {eventTransaction ? "событий" : crossSectional ? "сущностей" : timeSeries ? "наблюдений" : "строк"}</strong><strong>{profile.columnCount} переменных</strong><strong>{eventTransaction ? "Таблица событий/транзакций" : crossSectional ? "Таблица сущностей (поперечный срез)" : timeSeries ? profile.dateRange ? `${profile.dateRange.first} → ${profile.dateRange.last}` : "Период не определён" : "Структура требует уточнения"}</strong></div><button onClick={onContinue}>УКАЗАТЬ ЦЕЛЬ →</button></section> }
function DatasetSidebar({ dataset, profile, crossSectional, eventTransaction, timeSeries }: { dataset: UploadedDataset; profile: ReturnType<typeof profileDataset>; crossSectional: boolean; eventTransaction: boolean; timeSeries: boolean }) { return <aside className="dataset-sidebar"><p className="section-kicker">НАБОР ДАННЫХ</p><h3>{dataset.name}</h3><dl><div><dt>СТРОК</dt><dd>{profile.rowCount.toLocaleString()}</dd></div><div><dt>КОЛОНОК</dt><dd>{profile.columnCount}</dd></div><div><dt>{timeSeries ? "ПЕРИОД" : "СТРУКТУРА"}</dt><dd>{eventTransaction ? "СОБЫТИЯ/ТРАНЗАКЦИИ" : crossSectional ? "ПОПЕРЕЧНЫЙ СРЕЗ" : timeSeries ? profile.dateRange ? `${profile.dateRange.first} → ${profile.dateRange.last}` : "НЕ ОПРЕДЕЛЁН" : "ТРЕБУЕТ УТОЧНЕНИЯ"}</dd></div>{timeSeries && <div><dt>ЧАСТОТА</dt><dd>{profile.frequency ?? "НЕ ОПРЕДЕЛЕНА"}</dd></div>}<div><dt>ЧИСЛОВЫХ</dt><dd>{profile.numericColumns.length}</dd></div><div><dt>ПРОПУСКОВ</dt><dd>{profile.columns.reduce((total, column) => total + column.missing, 0)}</dd></div></dl><div className="adapter-badge"><span>МЕТОД</span><strong>ОПИСАТЕЛЬНЫЙ</strong><small>БЕЗ ПРИЧИННЫХ УТВЕРЖДЕНИЙ</small><p>Агенты решают, что проверять. Детерминированные инструменты считают все цифры.</p></div></aside> }
function Preview({ dataset, domain }: { dataset: UploadedDataset; domain: Domain }) { return <div className="preview"><span>ПРЕДПРОСМОТР ДАННЫХ <small>ПЕРВЫЕ 5 СТРОК</small></span><div><table><thead><tr>{dataset.columns.slice(0, 6).map((column) => <th key={column}>{displayDomainLabel(column, domain)}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 5).map((row, index) => <tr key={index}>{dataset.columns.slice(0, 6).map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div></div> }

function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** The action pipeline (propose → policy → execute → verify) has already fully run by the time this renders — the buttons below only ever serialize an already-verified file, they are never the execution step itself. */
const ACTION_LIFECYCLE_LINE: Record<ActionRecord["status"], string> = {
  PROPOSED: "PROPOSED",
  POLICY_APPROVED: "PROPOSED → POLICY APPROVED",
  REJECTED: "PROPOSED → REJECTED",
  EXECUTED: "PROPOSED → POLICY APPROVED → EXECUTED",
  VERIFIED: "PROPOSED → POLICY APPROVED → EXECUTED → VERIFIED ✓",
  FAILED: "PROPOSED → POLICY APPROVED → EXECUTED → FAILED",
};
/**
 * `action` is `null` for the brief window between commit and the owning view's effect resolving it — the
 * effect (not render) is what actually runs the deterministic propose→policy→execute→verify pipeline, so
 * there genuinely is a moment with no ActionRecord yet. This panel must never claim VERIFIED (or any other
 * status) before that effect has actually finished.
 */
function NextActionPanel({ action, human = false }: { action: ActionRecord | null; human?: boolean }) {
  if (!action) {
    if (human) return <section className="panel"><p className="section-kicker">СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</p><h2>Подготовка действия…</h2><p className="panel-intro">NEXUS предлагает и проверяет контролируемое действие для этого расследования.</p></section>;
    return <section className="panel">
      <div className="section-kicker">NEXT ACTION</div>
      <h2>Preparing action…</h2>
      <p className="panel-intro">NEXUS is proposing and validating the controlled action for this investigation.</p>
    </section>;
  }
  const rowCount = action.execution?.files[0]?.rowCount ?? action.proposal.evidenceRefs.length;
  if (human) return <section className="panel">
    <h3>{action.status === "VERIFIED" ? "Операционный пакет подготовлен и проверен" : action.status === "FAILED" || action.status === "REJECTED" ? "Операционный пакет не прошёл проверку" : "Подготовка операционного пакета"}</h3>
    <p>{action.status === "VERIFIED" ? "Экспорт подготовлен для рассмотрения оператором." : "Пакет предназначен для рассмотрения оператором; успешная проверка ещё не подтверждена."} Это не означает выполнение операционного вмешательства или изменение процесса.</p>
    {action.status === "VERIFIED" && action.execution && <div className="workspace-actions">{action.execution.files.map(file => <button key={file.fileName} className="secondary" onClick={() => downloadTextFile(file.fileName, file.mimeType, file.content)}>Скачать {file.fileName.endsWith(".csv") ? "CSV" : "JSON"}</button>)}</div>}

  </section>;
  const lifecycle = ACTION_LIFECYCLE_LINE[action.status];
  const detail = action.status === "REJECTED" ? action.policy.reason
    : action.status === "FAILED" ? (action.verification?.checks.filter((check) => !check.passed).map((check) => check.id).join(", ") || action.execution?.error || "Unknown failure.")
    : "Every step above ran deterministically, in memory, before this panel was shown.";
  return <section className="panel">
    <div className="section-kicker">NEXT ACTION</div>
    <h2>{action.id} · Export validated decision</h2>
    <p className="panel-intro">{action.proposal.reason}</p>
    <div className="tool-cards">
      <article><span>TARGET</span><strong>{action.proposal.target}</strong><p>{rowCount} row{rowCount === 1 ? "" : "s"}</p></article>
      <article><span>EVIDENCE</span><strong>{action.proposal.evidenceRefs.length} ref{action.proposal.evidenceRefs.length === 1 ? "" : "s"}</strong><p>{action.proposal.evidenceRefs.join(" · ") || "None"}</p></article>
      <article><span>STATUS</span><strong>{lifecycle}</strong><p>{detail}</p></article>
    </div>
    {action.status === "VERIFIED" && action.execution && <div className="workspace-actions">{action.execution.files.map((file) => <button key={file.fileName} className="secondary" onClick={() => downloadTextFile(file.fileName, file.mimeType, file.content)}>Download {file.fileName.endsWith(".csv") ? "CSV" : "JSON"}</button>)}</div>}
  </section>;
}

function EventTransactionResultsView({ dataset, results, objective, onEdit, onReset }: { dataset: UploadedDataset; results: EventTransactionWorkflowResult; objective: string; onEdit: () => void; onReset: () => void }) {
  const { artifact, validation } = results, { analysis } = artifact;
  const [action, setAction] = useState<ActionRecord | null>(null);
  // Keyed on the stable (workflowId, validatedArtifactHash) identity — not the `results` object reference,
  // which is a new object every render even when it describes the identical validated artifact. Running
  // the action is a real side effect (it mutates the module-level execution ledger/cache), so it belongs in
  // an effect that fires after commit, never in render or a useMemo calculation.
  const actionIdentity = `${artifact.workflowId}:${validation.validatedArtifactHash}`;
  useEffect(() => { setAction(getExportDecisionAction(results)); }, [actionIdentity]); // eslint-disable-line react-hooks/exhaustive-deps -- `results` is fully determined by `actionIdentity` for this view's lifetime; see comment above
  const summary = buildEventTransactionBusinessSummary(analysis);
  const topEntities = analysis.highlightedEntities.slice(0, 3);
  return <section className="workspace-section results mission-control decision-results">
    <header><div><p className="section-kicker">РАССЛЕДОВАНИЕ СОБЫТИЙ ЗАВЕРШЕНО</p><h2>{objective || dataset.name}</h2><small className="result-source">{dataset.name} · {analysis.dataset.eventCount} событий · {analysis.profile.uniqueEntities} сущностей · {artifact.investigator.source === "LLM" && artifact.skeptic.source === "LLM" ? "ИИ-агенты" : "Детерминированный резервный режим"}</small></div><span className={`status status-${validation.status === "VALIDATED" ? "supported" : "challenged"}`}>Результат проверен: {validation.status}</span></header>
    <div className="decision-view">
      <AgentChain />
      <section className="panel decision-summary"><p className="section-kicker">ЧТО ОБНАРУЖЕНО</p><h2>{summary.headline}</h2>
        <p className="decision-headline">{summary.whyItMatters}</p>
        {topEntities.length > 0 ? <div className="action-box"><p className="section-kicker">Что проверить в первую очередь</p>
          <ol>{topEntities.map((entity, index) => <li key={entity.entityId} className="a-item"><span className="rank">{index + 1}</span><div><b>{entity.entityId}</b><p>{entity.reasons.join("; ")}</p></div></li>)}</ol>
        </div> : <p className="caveat">{summary.nextSteps[0]}</p>}
        <div className="decision-stats">
          <div><span>Проанализировано событий</span><strong>{analysis.dataset.eventCount.toLocaleString("ru-RU")}</strong></div>
          <div><span>Замечено событий</span><strong>{analysis.detection.notableEvents.length}</strong></div>
          <div><span>Сущностей отмечено</span><strong>{analysis.highlightedEntities.length}</strong></div>
        </div>
        <p className="caveat">Не является вероятностью события или калиброванной уверенностью. Причинность не установлена.</p>
      </section>
      <NextActionPanel action={action} human />
      <TechnicalDetail>
      <div>
      <section className="business-block headline-block"><div><p className="section-kicker">СЕМАНТИКА СОБЫТИЙ</p><p className="business-headline">NEXUS рассматривает каждую исходную строку как одно событие и использует метки времени только для ограниченной группировки активности.</p></div><div><p className="section-kicker">ГРАНИЦЫ</p><p className="business-body">Обнаруженные шаблоны — нейтральные сигналы внимания. Мошенничество, инциденты безопасности, сбои и причинность не выводятся.</p></div></section>
      <section className="panel"><p className="section-kicker">ТИПЫ СОБЫТИЙ</p><h2>Точные частоты по источнику</h2><div className="tool-cards">{analysis.eventTypes.slice(0, 8).map((item) => <article key={item.eventType}><span>{displayLabel(analysis.semantics.eventTypeColumn)}</span><strong>{item.eventType}</strong><p>{item.count} событий · {(item.share * 100).toFixed(1)}%</p><small>EVIDENCE E-002</small></article>)}</div></section>
      <section className="panel"><p className="section-kicker">ДЕТЕРМИНИРОВАННЫЕ ПРАВИЛА ВНИМАНИЯ</p><h2>Заметная активность</h2><div className="tool-cards"><article><span>СКОПЛЕНИЯ</span><strong>{analysis.timing.bursts.length}</strong><p>Одна сущность с последовательными промежутками не более пяти минут; не менее трёх событий.</p><small>EVIDENCE E-004</small></article><article><span>ПОВТОРЯЮЩИЕСЯ ШАБЛОНЫ</span><strong>{analysis.detection.repeatedPatterns.length}</strong><p>Одна сущность, тип и значение повторяются в фиксированном окне.</p><small>EVIDENCE E-005</small></article><article><span>РЕДКИЕ ТИПЫ</span><strong>{analysis.detection.rareEventTypes.length}</strong><p>{analysis.detection.rareEventTypes.join(", ") || "Нет типов ниже опубликованного порога."}</p><small>EVIDENCE E-005</small></article><article><span>ЗАМЕЧЕННЫЕ СОБЫТИЯ</span><strong>{analysis.detection.notableEvents.length}</strong><p>Исходные события, соответствующие хотя бы одному проверяемому правилу.</p><small>EVIDENCE E-006</small></article></div></section>
      <section className="panel"><p className="section-kicker">АКТИВНОСТЬ СУЩНОСТЕЙ</p><h2>Сущности, требующие проверки</h2>{analysis.highlightedEntities.length ? <div className="tool-cards">{analysis.highlightedEntities.slice(0, 12).map((entity) => <article key={entity.entityId}><span>{entity.entityId}</span><strong>{entity.eventCount} событий</strong><p>{entity.reasons.join("; ")}</p><small>строки {formatBoundedIds(entity.sourceRows)} · E-007</small></article>)}</div> : <p className="panel-intro">Ни одна сущность не соответствует правилу внимания.</p>}</section>
      <section className="panel"><p className="section-kicker">ГРУППЫ АКТИВНОСТИ</p><h2>Связанные события одной сущности</h2>{analysis.clusters.length ? <div className="tool-cards">{analysis.clusters.slice(0, 12).map((cluster) => <article key={cluster.id}><span>{cluster.id} · {cluster.entityId}</span><strong>{cluster.eventIds.length} связанных событий</strong><p>{cluster.eventTypes.join(", ")}</p><small>строки {formatBoundedIds(cluster.sourceRows)} · E-007</small></article>)}</div> : <p className="panel-intro">Ни одно событие не соответствует фиксированному правилу группировки.</p>}</section>
      </div>
      <section className="panel"><p className="section-kicker">ИССЛЕДОВАТЕЛЬ</p><h2>Возможная интерпретация</h2><p className="business-body">{artifact.investigator.hypothesis}</p><p>{artifact.investigator.alternativeExplanation}</p><small>{artifact.investigator.source === "LLM" ? "ИИ-агент" : "Резервный режим"} · {artifact.investigator.selectedTool} · {artifact.investigator.evidenceRefs.join(" · ")}</small></section>
      <section className="panel"><p className="section-kicker">ПРОВЕРКА SKEPTIC</p><h2>{artifact.skeptic.status}</h2><p className="business-body">{artifact.skeptic.challenge}</p><p>{artifact.skeptic.alternativeExplanation}</p><small>{artifact.skeptic.source === "LLM" ? "ИИ-агент" : "Резервный режим"} · {artifact.skeptic.selectedTool} · {artifact.skeptic.evidenceRefs.join(" · ")}</small></section>
      <section className="panel panel-secondary"><p className="section-kicker">ОГРАНИЧЕНИЯ</p><ul className="finding-list">{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>

      <details className="result-secondary"><summary>Детерминированный Evidence</summary>{artifact.evidence.map((item) => <p key={item.id}><strong>{item.id} · {item.tool}()</strong><br />{item.result}</p>)}</details>
      <details className="result-secondary"><summary>Валидация</summary>{validation.checks.map((check) => <p key={check.id}><strong>{check.passed ? "✓" : "×"} {check.id}</strong><br />{check.detail}</p>)}<small>Проверенный артефакт: {validation.validatedArtifactHash}</small></details>
      <details className="raw-trace"><summary>TECHNICAL TRACE · Трассировка агентов</summary><AgentRuntimeTrace calls={artifact.technicalTrace.agentCalls} />{artifact.trace.map((entry, index) => <article key={`${entry.timestamp}-${index}`}><time>{entry.timestamp.slice(11, 19)}</time><strong>{entry.agent}</strong><span>{entry.summary}</span>{entry.tool && <em>{entry.tool}()</em>}{entry.evidenceRefs?.length ? <small>{entry.evidenceRefs.join(" · ")}</small> : null}<small className={`trace-source trace-${entry.source?.toLowerCase()}`}>{entry.source}</small></article>)}{(action?.trace ?? []).map((entry, index) => <article key={`action-${entry.timestamp}-${index}`}><time>{entry.timestamp.slice(11, 19)}</time><strong>{entry.agent}</strong><span>{entry.summary}</span>{entry.evidenceRefs?.length ? <small>{entry.evidenceRefs.join(" · ")}</small> : null}<small className="trace-source trace-deterministic">{entry.source}</small></article>)}</details>
      </TechnicalDetail>
      <div className="responsibility-split"><div><span>ИИ-АГЕНТЫ</span><p>Выбирают ограниченные проверки событий и интерпретируют существующие ссылки на Evidence.</p></div><div><span>ДЕТЕРМИНИРОВАННЫЙ ДВИЖОК</span><p>Рассчитывает каждый счётчик, порог, скопление, повторение, выброс, группу и отбор сущностей.</p></div></div>
    </div>
    <div className="workspace-actions"><button className="secondary" onClick={onEdit}>ИЗМЕНИТЬ НАСТРОЙКИ</button><button className="secondary" onClick={onReset}>НОВОЕ РАССЛЕДОВАНИЕ</button></div>
  </section>;
}

/** Plain-language description of a computed association's strength — never raw `r=`/`n=` notation, matching the same treatment TIME_SERIES's interpretation cards already give correlation values. */
function associationLabel(item: CrossSectionalAssociation): string {
  const observations = `${item.n} ${item.n === 1 ? "наблюдение" : item.n < 5 ? "наблюдения" : "наблюдений"}`;
  if (item.method !== "PEARSON") return `Заметное различие между группами · ${observations}`;
  const strength = classifyCorrelationStrength(item.value);
  const direction = item.value > 0 ? "прямая" : item.value < 0 ? "обратная" : "нулевая";
  return `${strength ? strengthText[strength] : "неопределённая"} ${direction} связь · ${observations}`;
}

function CrossSectionalResultsView({ dataset, results, objective, onEdit, onReset }: { dataset: UploadedDataset; results: CrossSectionalWorkflowResult; objective: string; onEdit: () => void; onReset: () => void }) {
  const { artifact, validation } = results; const { analysis } = artifact;
  const [action, setAction] = useState<ActionRecord | null>(null);
  // Same reasoning as EventTransactionResultsView: keyed on the stable identity, run in an effect after
  // commit — never during render — because the action pipeline is a real side effect.
  const actionIdentity = `${artifact.workflowId}:${validation.validatedArtifactHash}`;
  useEffect(() => { setAction(getExportDecisionAction(results)); }, [actionIdentity]); // eslint-disable-line react-hooks/exhaustive-deps -- `results` is fully determined by `actionIdentity` for this view's lifetime; see comment above
  const summary = buildCrossSectionalBusinessSummary(analysis);
  const topDrivers = analysis.drivers.slice(0, 3);
  const keyNumeric = ["risk_score", "DTI", "credit_rating", "loan_amount", "monthly_payment"].map((column) => analysis.numericSummaries.find((item) => item.column === column)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const keyCategories = ["risk_category", "region", "loan_type", "employment_type"].map((column) => analysis.categoricalSummaries.find((item) => item.column === column)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return <section className="workspace-section results mission-control decision-results">
    <header><div><p className="section-kicker">РАССЛЕДОВАНИЕ ПОПЕРЕЧНОГО СРЕЗА ЗАВЕРШЕНО</p><h2>{objective || dataset.name}</h2><small className="result-source">{dataset.name} · {analysis.dataset.entityCount} сущностей · {artifact.evidence.length} записей Evidence · {artifact.investigator.source === "LLM" && artifact.skeptic.source === "LLM" ? "ИИ-агенты" : "Детерминированный резервный режим"}</small></div><span className={`status status-${validation.status === "VALIDATED" ? "supported" : "challenged"}`}>Результат проверен: {validation.status}</span></header>
    <div className="decision-view">
      <AgentChain />
      <section className="panel decision-summary"><p className="section-kicker">ЧТО ОБНАРУЖЕНО</p><h2>{summary.headline}</h2>
        <p className="decision-headline">{summary.whyItMatters}</p>
        {topDrivers.length > 0 ? <div className="action-box"><p className="section-kicker">Что проверить в первую очередь</p>
          <ol>{topDrivers.map((item, index) => <li key={`${item.predictor}-${item.target}`} className="a-item"><span className="rank">{index + 1}</span><div><b>{displayLabel(item.predictor)} → {displayLabel(item.target)}</b><p>{associationLabel(item)}</p></div></li>)}</ol>
        </div> : <p className="caveat">{summary.nextSteps[0]}</p>}
        <div className="decision-stats">
          <div><span>Проанализировано записей</span><strong>{analysis.dataset.entityCount.toLocaleString("ru-RU")}</strong></div>
          <div><span>Связей ранжировано</span><strong>{analysis.drivers.length}</strong></div>
          <div><span>Отобрано для проверки</span><strong>{analysis.highRisk.entities.length}</strong></div>
        </div>
        <p className="caveat">Не является вероятностью события или калиброванной уверенностью. Причинность не установлена.</p>
      </section>
      <NextActionPanel action={action} human />
      <TechnicalDetail>
      <section className="panel jury-investigation"><p className="section-kicker">ЧТО ОБНАРУЖИЛ NEXUS</p><h2>Как система проверила рабочую гипотезу</h2>
        <div className="jury-story-grid">
          <article><span>ГИПОТЕЗА INVESTIGATOR</span><blockquote>{artifact.investigator.hypothesis}</blockquote><p><strong>Альтернативное объяснение:</strong> {artifact.investigator.alternativeExplanation}</p><small>{artifact.investigator.source === "LLM" ? "ИИ-агент" : "Резервный режим"} · {artifact.investigator.rationale}</small></article>
          <article className="evidence-authority" data-authority="deterministic"><span>ДЕТЕРМИНИРОВАННЫЙ EVIDENCE</span>{topDrivers.map(item => <div key={`${item.predictor}-${item.target}`}><strong>{displayLabel(item.predictor)} → {displayLabel(item.target)}</strong><p>{associationLabel(item)}</p></div>)}</article>
          <article className="skeptic-story"><span>НЕЗАВИСИМАЯ ПРОВЕРКА SKEPTIC</span><h3>{artifact.skeptic.status}</h3><small className="skeptic-status-note">Результат попытки Skeptic независимо оспорить гипотезу — не итоговый статус расследования (см. статус выше).</small><blockquote>{artifact.skeptic.challenge}</blockquote><p>{artifact.skeptic.alternativeExplanation}</p></article>
        </div>
        <div className="jury-conclusion-grid">
          <article className="conclusion-primary"><span>ВЫВОД</span><p>{summary.headline}</p></article>
          <article><span>НЕОПРЕДЕЛЁННОСТЬ</span><ul>{summary.uncertainty.map(item => <li key={item}>{item}</li>)}</ul></article>
          <article><span>СЛЕДУЮЩАЯ ПРОВЕРКА ОПЕРАТОРА</span><ol>{summary.nextSteps.map(item => <li key={item}>{item}</li>)}</ol></article>
        </div>
      </section>
      <section className="panel"><p className="section-kicker">ЧИСЛОВЫЕ ПОКАЗАТЕЛИ</p><h2>Портфельные величины</h2><div className="tool-cards">{keyNumeric.map((item) => <article key={item.column}><span>{displayLabel(item.column)}</span><strong>{item.mean.toFixed(2)} среднее</strong><p>медиана {item.median.toFixed(2)} · диапазон {item.min.toFixed(2)}–{item.max.toFixed(2)}</p><small>n={item.count} · пропусков={item.missing} · СКО={item.standardDeviation.toFixed(2)}</small></article>)}</div></section>
      <section className="panel"><p className="section-kicker">РАСПРЕДЕЛЕНИЕ СЕГМЕНТОВ</p><h2>Концентрация категорий</h2><div className="tool-cards">{keyCategories.map((item) => <article key={item.column}><span>{displayLabel(item.column)}</span><strong>{item.distinct} категорий</strong><p>{item.values.map((value) => `${value.value}: ${value.count}`).join(" · ")}</p><small>n={item.count} · пропусков={item.missing}</small></article>)}</div><p className="panel-intro">Доля просрочки: {analysis.delinquencyPrevalence.rate === null ? "нет данных" : `${analysis.delinquencyPrevalence.affected} из ${analysis.delinquencyPrevalence.total} записей (${(analysis.delinquencyPrevalence.rate * 100).toFixed(1)}%)`} · Evidence E-006</p></section>
      <section className="panel"><p className="section-kicker">СВЯЗИ С ИТОГОВЫМ ПОКАЗАТЕЛЕМ</p><h2>Сильнейшие рассчитанные связи</h2>{analysis.drivers.length ? <div className="tool-cards">{analysis.drivers.map((item) => <article key={`${item.predictor}-${item.method}`}><span>{item.method}</span><strong>{displayLabel(item.predictor)} → {displayLabel(item.target)}</strong><p>{item.method === "PEARSON" ? `r=${item.value.toFixed(3)} · |r|=${item.absoluteStrength.toFixed(3)}` : `стандартизованный диапазон группового среднего=${item.absoluteStrength!.toFixed(3)}`}</p><small>n={item.n} · только связь · E-004</small></article>)}</div> : <p className="panel-intro">Ни одна числовая связь с итоговым показателем не ранжирована.</p>}<p className="panel-intro"><strong>ПРИЧИННОСТЬ: НЕ УСТАНОВЛЕНА.</strong></p></section>
      <section className="panel"><p className="section-kicker">ЗАПИСИ, ТРЕБУЮЩИЕ ВНИМАНИЯ</p><h2>Явное правило по заданному итоговому показателю</h2><p className="panel-intro">{analysis.highRisk.rule}</p>{analysis.highRisk.entities.length ? <div className="tool-cards">{analysis.highRisk.entities.map((entity) => <article key={entity.entityId}><span>{entity.entityId} · СТРОКА {entity.sourceRow}</span><strong>{analysis.target.column}: {String(entity.targetValue)}</strong><p>{entity.reasons.join("; ")}</p><small>{entity.evidenceRefs.join(" · ")}</small></article>)}</div> : <p>Записи не отранжированы: подтверждённый итоговый показатель или поддерживаемая метка риска недоступны.</p>}</section>
      <section className="panel panel-secondary"><p className="section-kicker">МЕТОДОЛОГИЧЕСКИЕ ОГРАНИЧЕНИЯ</p><ul className="finding-list">{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>

      <details className="result-secondary"><summary>Детерминированный Evidence</summary>{artifact.evidence.map((item) => <p key={item.id}><strong>{item.id} · {item.tool}()</strong><br />{item.result}<br /><small>Использовано: {item.usedBy.join(", ")}</small></p>)}</details>
      <details className="result-secondary"><summary>Валидация</summary>{validation.checks.map((check) => <p key={check.id}><strong>{check.passed ? "✓" : "×"} {check.id}</strong><br />{check.detail}</p>)}<small>Проверенный артефакт: {validation.validatedArtifactHash}</small></details>
      <details className="raw-trace"><summary>TECHNICAL TRACE · Трассировка агентов</summary><AgentRuntimeTrace calls={artifact.technicalTrace.agentCalls} />{artifact.trace.map((entry, index) => <article key={`${entry.timestamp}-${index}`}><time>{entry.timestamp.slice(11, 19)}</time><strong>{entry.agent}</strong><span>{entry.summary}</span>{entry.tool && <em>{entry.tool}()</em>}{entry.evidenceRefs?.length ? <small>{entry.evidenceRefs.join(" · ")}</small> : null}<small className={`trace-source trace-${entry.source?.toLowerCase()}`}>{entry.source}</small></article>)}{(action?.trace ?? []).map((entry, index) => <article key={`action-${entry.timestamp}-${index}`}><time>{entry.timestamp.slice(11, 19)}</time><strong>{entry.agent}</strong><span>{entry.summary}</span>{entry.evidenceRefs?.length ? <small>{entry.evidenceRefs.join(" · ")}</small> : null}<small className="trace-source trace-deterministic">{entry.source}</small></article>)}</details>
      </TechnicalDetail>
      <div className="responsibility-split"><div><span>ИИ-АГЕНТЫ</span><p>Выбрали ограниченные проверки и интерпретировали проверенные ссылки на Evidence.</p></div><div><span>ДЕТЕРМИНИРОВАННЫЙ ДВИЖОК</span><p>Рассчитал все распределения, количества, связи, пороги, ранжирование записей и проверки валидации.</p></div></div>
    </div>
    <div className="workspace-actions"><button className="secondary" onClick={onEdit}>ИЗМЕНИТЬ НАСТРОЙКИ</button><button className="secondary" onClick={onReset}>НОВОЕ РАССЛЕДОВАНИЕ</button></div>
  </section>;
}

function ResultsView({ dataset, results, objective, onEdit, onReset, domainId }: { domainId?: string; dataset: UploadedDataset; results: TimeSeriesResults; objective: string; onEdit: () => void; onReset: () => void }) {
  const [action, setAction] = useState<ActionRecord | null>(null);
  const [scenarioChange, setScenarioChange] = useState(0);
  const [scenarioExportError, setScenarioExportError] = useState("");
  useEffect(() => { setScenarioChange(getDomainPack(domainId ?? "")?.scenario?.control.minChange ?? 0); setScenarioExportError(""); }, [results.artifact, domainId]);
  useEffect(() => { setAction(null); }, [results.artifact.workflowId, results.validation.validatedArtifactHash, results.validation.status]);
  const [drawer, setDrawer] = useState<"why" | "evidence" | "">("");
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeDrawer = () => { setDrawerClosing(true); window.setTimeout(() => { setDrawer(""); setDrawerClosing(false); }, 220); };
  const { agentic } = results;
  const decision = useMemo(() => buildInvestigationViewModel({ artifact: results.artifact, validation: results.validation, dataset, evidence: agentic.evidence, agentic, domainId }), [results.artifact, results.validation, dataset, agentic, domainId]);
  const [reportStatus, setReportStatus] = useState<"idle" | "generating" | "error">("idle");
  const downloadReport = async () => {
    if (reportStatus === "generating") return;
    setReportStatus("generating");
    try {
      const report = buildInvestigationReportModel(results.analysis, agentic, objective, dataset.name, domainId);
      const { downloadInvestigationReportPdf } = await import("@/lib/nexus/report/pdfReport");
      await downloadInvestigationReportPdf(report);
      setReportStatus("idle");
    } catch {
      setReportStatus("error");
    }
  };

  return <section className="workspace-section results mission-control decision-results">
    <header><div><p className="section-kicker">РАССЛЕДОВАНИЕ ЗАВЕРШЕНО</p><h2>{decision.targetLabel}</h2>{objective && <p className="result-objective">Цель расследования: {objective}</p>}<small className="result-source">{dataset.name} · {agentic.evidence.length} записей Evidence · {agentic.investigator.source === "LLM" ? "ИИ-агенты" : "Детерминированный резервный режим"}</small></div><span className={`status status-${decision.validationStatus.toLowerCase()}`}>Результат проверен: {decision.validationStatus}</span></header>

    <DecisionView model={decision} />
    {decision && <details className="result-secondary"><summary>Технические детали и Evidence</summary>
      <p className="panel-intro">E-001, E-002… — идентификаторы доказательств, полученных NEXUS в ходе расследования; они используются, чтобы проследить вывод от инструмента до гипотезы и итогового заключения.</p>
      <h3>Evidence и происхождение данных</h3>{agentic.evidence.map(e => <article key={e.id}><h4>{e.id} · {e.tool}</h4><p>{e.result}</p><p>{e.variables.join(" · ")} · {e.usedBy.join(" · ")}</p><pre>{JSON.stringify(e.data, null, 2)}</pre></article>)}
      <div className="raw-trace"><h3>TECHNICAL TRACE · Трассировка агентов</h3>{(agentic.investigator.runtime || agentic.skeptic?.runtime) && <AgentRuntimeTrace runtime={[agentic.investigator.runtime, agentic.skeptic?.runtime]} />}{agentic.trace.map((entry, index) => <p key={index}>{entry.timestamp} · {entry.agent} · {entry.tool} · {entry.summary} · {entry.evidenceRefs?.join(" · ")} · {runtimeSourceLabel(entry.source)}</p>)}</div>
      <h3>Статистические данные</h3><pre>{JSON.stringify(results.artifact.precursorChain, null, 2)}</pre>
      <h3>Валидатор</h3><pre>{JSON.stringify(results.validation, null, 2)}</pre>
      <h3>Трассировка действия</h3>{action ? <><p>{action.id} · {ACTION_LIFECYCLE_LINE[action.status]}</p><pre>{JSON.stringify({ proposal: action.proposal, policy: action.policy, verification: action.verification }, null, 2)}</pre>{action.trace.map((entry, index) => <p key={index}>{entry.timestamp} · {entry.summary}</p>)}</> : <p>Действие ещё не подготовлено.</p>}
      <h3>Исходный профиль данных</h3><pre>{JSON.stringify(results.analysis.profile, null, 2)}</pre>
    </details>}
    {decision?.scenario && results.validation.status === "VALIDATED" && <ScenarioPanel scenario={decision.scenario} changePct={scenarioChange} onChange={setScenarioChange} />}
    {decision && <section className="panel export-action-panel"><p className="section-kicker">КОНТРОЛИРУЕМОЕ ДЕЙСТВИЕ</p><h2>Подготовить сигналы для операционного разбора</h2><p>Экспорт подготовлен для рассмотрения оператором. Операционное вмешательство не выполняется; проблема не объявляется решённой.</p><button disabled={results.validation.status !== "VALIDATED" || Boolean(action)} onClick={() => setAction(getExportDecisionAction(results))}>Подготовить и проверить экспорт</button>{action && <NextActionPanel action={action} human />}
      {action?.status === "VERIFIED" && decision.scenario && <><p>Дополнительный модельный пакет содержит проверенный наблюдаемый экспорт, выбранный сценарий, варианты вмешательства и модельные допущения. Он проверяется отдельно и не становится Observed Evidence.</p><button className="secondary" onClick={() => {
        try {
          const input = { result: results, dataset, domainId: domainId ?? "", changePct: scenarioChange, action };
          const content = buildScenarioReviewPackage(input);
          if (!verifyScenarioReviewPackage(input, content)) throw new Error("Модельный пакет не прошёл проверку.");
          downloadTextFile("operational_model_review.json", "application/json", content);
          setScenarioExportError("");
        } catch { setScenarioExportError("Модельный пакет не прошёл проверку; скачивание отменено."); }
      }}>Проверить и скачать модельный пакет</button></>}
      {scenarioExportError && <p role="alert">{scenarioExportError}</p>}
    </section>}
    <div className="workspace-actions"><button onClick={() => setDrawer("why")}>Почему NEXUS сделал такой вывод?</button><button className="secondary" onClick={() => setDrawer("evidence")}>Показать Evidence</button><button className="secondary report-download" disabled={reportStatus === "generating"} onClick={() => void downloadReport()}>{reportStatus === "generating" ? "Формируем отчёт…" : "Скачать отчёт"}</button><button className="secondary" onClick={onEdit}>Изменить настройки</button><button className="secondary" onClick={onReset}>Новое расследование</button></div>
    {reportStatus === "error" && <p className="report-error">Не удалось сформировать отчёт. Попробуйте ещё раз.</p>}

    {drawer && <aside className={`evidence-drawer${drawerClosing ? " closing" : ""}`}><button aria-label="Close" onClick={closeDrawer}>×</button><p className="section-kicker">{drawer === "why" ? "МЕТОД И ГРАНИЦЫ ПОЛНОМОЧИЙ" : "ДЕТЕРМИНИРОВАННЫЕ ДОКАЗАТЕЛЬСТВА"}</p>{drawer === "why" ? <><h3>Почему NEXUS сделал такой вывод</h3><p>Все числа рассчитаны детерминированными инструментами. Агенты выбирали, что исследовать, какое объяснение проверить и какое предположение оспорить.</p><ul>{agentic.hypothesis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></> : <><h3>Записи Evidence</h3>{agentic.evidence.map((item) => <p key={item.id}><strong>{item.id} · {item.tool}</strong><br />{item.result}<br /><small>Used by: {item.usedBy.join(", ")}</small></p>)}</>}</aside>}
  </section>;
}
