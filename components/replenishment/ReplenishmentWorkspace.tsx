"use client";

import { useMemo, useState } from "react";
import { assembleReplenishmentInput, DEFAULT_ASSEMBLY_ASSUMPTIONS, type SupplierParsedData } from "@/lib/nexus/replenishment/assemble";
import { calculateReplenishment, type ReplenishmentPlan, type ReplenishmentRecommendation } from "@/lib/nexus/replenishment/calculation";
import type { ReplenishmentNarrationInput } from "@/lib/nexus/replenishment/narration";
import { parseInboundShipments, parseMinimumOrderQuantities, parseMonthlyOpeningStock, parseMonthlySales, parseSalesTransactions, parseSkuCategories, parseSkuCurrentStocks, parseSkuReservations } from "@/lib/nexus/replenishment/xlsxParsers";
import styles from "./replenishment.module.css";

type FileKind = "transactions" | "monthlySales" | "openingStocks" | "inbound" | "moq";
type SupplierKey = "iek" | "systeme";
type FilesState = Record<SupplierKey, Partial<Record<FileKind, File>>>;
type ExceptionView = "all" | "urgent" | "anomaly" | "supply" | "surplus";
type ManagerDecision = { quantity: number; status: "draft" | "confirmed" };
type PlanningControls = {
  leadTimeMonths: number;
  reviewPeriodMonths: number;
  forecastGrowthPercent: number;
  serviceLevelA: number;
  serviceLevelB: number;
  serviceLevelC: number;
  unclassifiedServiceLevel: number;
};

const FILE_FIELDS: Array<{ kind: FileKind; label: string; hint: string }> = [
  { kind: "transactions", label: "Динамика продаж", hint: "Транзакции и накладные" },
  { kind: "monthlySales", label: "Продажи по месяцам", hint: "Количество по SKU" },
  { kind: "openingStocks", label: "Остатки по месяцам", hint: "Начальный остаток" },
  { kind: "inbound", label: "Товар в пути", hint: "Поставки и категории" },
  { kind: "moq", label: "MOQ / кратность", hint: "Шаг округления заказа" },
];
const SUPPLIERS: Array<{ key: SupplierKey; name: string; code: string }> = [
  { key: "iek", name: "IEK", code: "01" },
  { key: "systeme", name: "Systeme Electric", code: "02" },
];

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 0 });
const urgencyLabel = { high: "Срочно", medium: "Контроль", low: "Планово" } as const;
const urgencyRank = { high: 0, medium: 1, low: 2 } as const;
const demandPatternLabel = { stable: "Стабильный", volatile: "Волатильный", intermittent: "Прерывистый" } as const;
const lifecycleLabel = { active: "Активный", slow: "Медленный", dead: "Мёртвый запас" } as const;
const exceptionViews: Array<{ key: ExceptionView; label: string }> = [
  { key: "all", label: "Все SKU" }, { key: "urgent", label: "Заказать сейчас" },
  { key: "anomaly", label: "Аномалии спроса" }, { key: "supply", label: "Риски поставки" },
  { key: "surplus", label: "Избыток" },
];

function matchesExceptionView(item: ReplenishmentRecommendation, view: ExceptionView): boolean {
  if (view === "urgent") return item.urgency === "high";
  if (view === "anomaly") return item.exceptions.some((value) => ["stockout", "one_off_spike", "sustained_growth_signal", "slow_stock", "dead_stock"].includes(value));
  if (view === "supply") return item.exceptions.some((value) => ["unknown_eta", "inbound_after_horizon"].includes(value));
  if (view === "surplus") return item.exceptions.includes("surplus");
  return true;
}

function validManagerQuantity(quantity: number, moq: number | null): number {
  const safe = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
  return moq && safe > 0 ? Math.ceil(safe / moq) * moq : safe;
}

const serviceLevel = (percentValue: number): number => Math.min(99.5, Math.max(90, percentValue)) / 100;
const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;

async function parseSupplier(key: SupplierKey, files: Partial<Record<FileKind, File>>): Promise<SupplierParsedData> {
  for (const field of FILE_FIELDS) if (!files[field.kind]) throw new Error(`Не выбран файл «${field.label}» для ${key === "iek" ? "IEK" : "Systeme Electric"}.`);
  const read = async (kind: FileKind) => new Uint8Array(await files[kind]!.arrayBuffer());
  const [transactions, monthlySales, openingStocks, inbound, moq] = await Promise.all([
    read("transactions"), read("monthlySales"), read("openingStocks"), read("inbound"), read("moq"),
  ]);
  return {
    supplier: key === "iek" ? "IEK" : "Systeme Electric",
    salesTransactions: parseSalesTransactions(transactions),
    monthlySales: parseMonthlySales(monthlySales),
    openingStocks: parseMonthlyOpeningStock(openingStocks),
    inboundShipments: parseInboundShipments(inbound),
    minimumOrderQuantities: parseMinimumOrderQuantities(moq),
    ...(key === "systeme" ? {
      categories: parseSkuCategories(inbound),
      reservations: parseSkuReservations(inbound),
      currentStocks: parseSkuCurrentStocks(inbound),
    } : { reservations: [], currentStocks: [] }),
  };
}

function explanation(item: ReplenishmentRecommendation): string {
  const seasonalPath = item.seasonalForecast.map((month) => `${month.month} ×${number.format(month.seasonalIndex)}`).join(", ");
  const stockBasis = item.currentStockSource === "explicit_snapshot"
    ? "фактический снимок"
    : `оценка: начальный остаток ${number.format(item.openingStockAsOf)} − продажи ${number.format(item.salesSinceOpening)}`;
  return `Тип спроса: ${demandPatternLabel[item.demandPattern]}, статус SKU: ${lifecycleLabel[item.stockLifecycleStatus]}, плановый спрос ${number.format(item.planningMonthlyDemand)} ед./мес. Базовый спрос ${number.format(item.baseMonthlyDemand)} ед./мес.; средняя сезонность будущего горизонта ×${number.format(item.seasonalIndex)} (${seasonalPath}); исторический рост ${percent.format(item.historicalGrowthRate)}; внешний прогноз ${percent.format(item.forecastGrowthRate)}. Поправка stockout: +${number.format(item.stockoutAdjustmentUnitsPerMonth)} ед./мес. (${item.stockoutMonths.length} мес.); исключено всплесков: ${item.excludedSpikeCount} на ${number.format(item.excludedSpikeUnits)} ед., оценка влияния на заказ ${number.format(item.spikeOrderImpactEstimate)} ед.; сохранено повторных крупных продаж: ${item.retainedGrowthSpikeCount}. Страховой запас ${number.format(item.safetyStock)} = z ${number.format(item.safetyStockZScore)} × σ ${number.format(item.demandStdDev)} × √горизонта, уровень сервиса ${percent.format(item.serviceLevel)}. Позиция: остаток ${number.format(item.currentStock)} (${stockBasis}) − резерв ${number.format(item.reservedStock)} + подтверждённо в пути ${number.format(item.goodsInTransitWithinHorizon)}; без точного ETA ${number.format(item.goodsInTransitUnknownEta)} не уменьшает заказ, после горизонта ${number.format(item.goodsInTransitAfterHorizon)}; доступный остаток ${number.format(item.availableStock)}, целевой уровень ${number.format(item.targetPosition)}.`;
}

function narrationInput(item: ReplenishmentRecommendation): ReplenishmentNarrationInput {
  const {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, seasonalForecast, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, retainedGrowthSpikeCount, retainedGrowthSpikeUnits, spikeOrderImpactEstimate,
    openingStockAsOf, salesSinceOpening, currentStock, currentStockSource, reservedStock, availableStock, goodsInTransitWithinHorizon, goodsInTransitUnknownEta,
    goodsInTransitAfterHorizon, etaAssumptionApplied, unknownEtaExcluded, demandPattern, nonZeroDemandFrequency, forecastMethod, exceptions,
    planningMonthlyDemand, stockLifecycleStatus, daysOfSupply, isOverstock, overstockMonths,
    nearestInboundExpectedDate, projectedStockoutDate, potentialStockoutDays,
    demandStdDev, serviceLevel, safetyStockZScore, safetyStock, targetPosition, currentPosition,
    recommendedOrder, urgency,
  } = item;
  return {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, seasonalForecast, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, retainedGrowthSpikeCount, retainedGrowthSpikeUnits, spikeOrderImpactEstimate,
    openingStockAsOf, salesSinceOpening, currentStock, currentStockSource, reservedStock, availableStock, goodsInTransitWithinHorizon, goodsInTransitUnknownEta,
    goodsInTransitAfterHorizon, etaAssumptionApplied, unknownEtaExcluded, demandPattern, nonZeroDemandFrequency, forecastMethod, exceptions,
    planningMonthlyDemand, stockLifecycleStatus, daysOfSupply, isOverstock, overstockMonths,
    nearestInboundExpectedDate, projectedStockoutDate, potentialStockoutDays,
    demandStdDev, serviceLevel, safetyStockZScore, safetyStock, targetPosition, currentPosition,
    recommendedOrder, urgency,
  };
}

export function ReplenishmentWorkspace() {
  const [files, setFiles] = useState<FilesState>({ iek: {}, systeme: {} });
  const [plan, setPlan] = useState<ReplenishmentPlan>();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [narrating, setNarrating] = useState<Record<string, boolean>>({});
  const [exceptionView, setExceptionView] = useState<ExceptionView>("all");
  const [decisions, setDecisions] = useState<Record<string, ManagerDecision>>({});
  const [planning, setPlanning] = useState<PlanningControls>({
    leadTimeMonths: DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultLeadTimeMonths,
    reviewPeriodMonths: DEFAULT_ASSEMBLY_ASSUMPTIONS.reviewPeriodMonths,
    forecastGrowthPercent: DEFAULT_ASSEMBLY_ASSUMPTIONS.defaultForecastGrowthRate * 100,
    serviceLevelA: 98,
    serviceLevelB: 95,
    serviceLevelC: 90,
    unclassifiedServiceLevel: 95,
  });
  const selectedCount = Object.values(files).flatMap((group) => Object.values(group)).length;
  const ready = selectedCount === FILE_FIELDS.length * SUPPLIERS.length;

  const visible = useMemo(() => plan?.suppliers.map((group) => ({
    ...group,
    items: group.items.filter((item) => matchesExceptionView(item, exceptionView) && `${item.sku} ${item.productName}`.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))).sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.recommendedOrder - a.recommendedOrder),
  })).map((group) => ({ ...group, totalRecommendedUnits: group.items.reduce((sum, item) => sum + item.recommendedOrder, 0) })) ?? [], [plan, query, exceptionView]);
  const confirmedRows = useMemo(() => plan?.suppliers.flatMap((group) => group.items.flatMap((item) => {
    const decision = decisions[`${item.supplier}:${item.sku}`];
    return decision?.status === "confirmed" ? [{ item, quantity: decision.quantity }] : [];
  })) ?? [], [plan, decisions]);

  const downloadConfirmedOrders = () => {
    if (!confirmedRows.length) return;
    const header = ["Поставщик", "SKU", "Наименование", "Рекомендация", "Подтверждено", "Срочность"];
    const rows = confirmedRows.map(({ item, quantity }) => [item.supplier, item.sku, item.productName, item.recommendedOrder, quantity, item.urgency]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus-purchase-orders-${plan?.asOfMonth ?? "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    setRunning(true); setError(""); setPlan(undefined); setDecisions({}); setExceptionView("all");
    try {
      // Yield once so the pending state paints before large partner workbooks are decoded.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const parsed = await Promise.all(SUPPLIERS.map((supplier) => parseSupplier(supplier.key, files[supplier.key])));
      const assumptions = {
        ...DEFAULT_ASSEMBLY_ASSUMPTIONS,
        defaultLeadTimeMonths: Math.max(0.1, planning.leadTimeMonths),
        reviewPeriodMonths: Math.max(0, planning.reviewPeriodMonths),
        defaultForecastGrowthRate: Math.max(-99, planning.forecastGrowthPercent) / 100,
        categoryServiceLevel: {
          ...DEFAULT_ASSEMBLY_ASSUMPTIONS.categoryServiceLevel,
          "1": serviceLevel(planning.serviceLevelA), A: serviceLevel(planning.serviceLevelA),
          "2": serviceLevel(planning.serviceLevelB), B: serviceLevel(planning.serviceLevelB),
          "3": serviceLevel(planning.serviceLevelC), "4": serviceLevel(planning.serviceLevelC), C: serviceLevel(planning.serviceLevelC),
          UNCLASSIFIED: serviceLevel(planning.unclassifiedServiceLevel),
        },
      };
      setPlan(calculateReplenishment(assembleReplenishmentInput(parsed, assumptions)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обработать XLSX-файлы.");
    } finally { setRunning(false); }
  };

  const requestNarrative = async (item: ReplenishmentRecommendation) => {
    const key = `${item.supplier}:${item.sku}`;
    setNarrating((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/replenishment/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(narrationInput(item)),
      });
      const result = await response.json() as { narrative?: unknown; source?: unknown };
      const narrative = typeof result.narrative === "string" ? result.narrative.trim() : "";
      if (response.ok && result.source === "LLM" && narrative) {
        setNarratives((current) => ({ ...current, [key]: narrative }));
      }
    } catch {
      // The deterministic explanation remains visible; LLM narration is optional enhancement only.
    } finally {
      setNarrating((current) => ({ ...current, [key]: false }));
    }
  };

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <a href="/" className={styles.brand}><span>ЭК</span><b>Электрокомплект</b></a>
      <div className={styles.system}>REPLENISHMENT CONTROL / v1.0</div>
      <div className={styles.status}><i /> Детерминированный расчёт</div>
    </header>

    <section className={styles.hero}>
      <div><p className={styles.kicker}>Автоматический расчёт заказов поставщикам</p><h1>Склад без<br /><em>догадок.</em></h1></div>
      <p className={styles.lead}>Загрузите пять исходных книг по каждому поставщику. Система очистит спрос, учтёт сезонность, дефицит, поставки в пути и MOQ — и покажет проверяемый заказ.</p>
      <div className={styles.formula}><span>РАСЧЁТНАЯ МОДЕЛЬ</span><code>СПРОС × ГОРИЗОНТ + ЗАПАС − ПОЗИЦИЯ</code><small>LLM не участвует в вычислениях</small></div>
    </section>

    {!plan && <section className={styles.uploadArea} aria-label="Загрузка исходных файлов">
      <div className={styles.sectionHead}><span>01</span><div><p>Входные данные</p><h2>Два поставщика. Один расчётный контур.</h2></div><b>{selectedCount}/10 файлов</b></div>
      <div className={styles.supplierGrid}>{SUPPLIERS.map((supplier) => <article className={styles.supplierCard} key={supplier.key}>
        <header><span>{supplier.code}</span><div><small>ПОСТАВЩИК</small><h3>{supplier.name}</h3></div></header>
        <div className={styles.fileList}>{FILE_FIELDS.map((field) => {
          const file = files[supplier.key][field.kind];
          return <label className={`${styles.fileField} ${file ? styles.loaded : ""}`} key={field.kind}>
            <input type="file" accept=".xlsx,.xls" onChange={(event) => {
              const next = event.target.files?.[0];
              setFiles((current) => ({ ...current, [supplier.key]: { ...current[supplier.key], [field.kind]: next } }));
            }} />
            <span>{file ? "✓" : "+"}</span><div><b>{field.label}</b><small>{file?.name ?? field.hint}</small></div>
          </label>;
        })}</div>
      </article>)}</div>
      <fieldset className={styles.planningControls}>
        <legend>Плановые допущения</legend>
        <label><span>Срок поставки, мес.</span><input type="number" min="0.1" step="0.1" value={planning.leadTimeMonths} onChange={(event) => setPlanning((current) => ({ ...current, leadTimeMonths: Number(event.target.value) }))} /></label>
        <label><span>Период пересмотра, мес.</span><input type="number" min="0" step="0.1" value={planning.reviewPeriodMonths} onChange={(event) => setPlanning((current) => ({ ...current, reviewPeriodMonths: Number(event.target.value) }))} /></label>
        <label><span>Внешний прогноз, %</span><input type="number" min="-99" step="1" value={planning.forecastGrowthPercent} onChange={(event) => setPlanning((current) => ({ ...current, forecastGrowthPercent: Number(event.target.value) }))} /></label>
        <label><span>Сервис A / кат. 1, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelA} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelA: Number(event.target.value) }))} /></label>
        <label><span>Сервис B / кат. 2, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelB} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelB: Number(event.target.value) }))} /></label>
        <label><span>Сервис C / кат. 3–4, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.serviceLevelC} onChange={(event) => setPlanning((current) => ({ ...current, serviceLevelC: Number(event.target.value) }))} /></label>
        <label><span>Сервис IEK без категории, %</span><input type="number" min="90" max="99.5" step="0.1" value={planning.unclassifiedServiceLevel} onChange={(event) => setPlanning((current) => ({ ...current, unclassifiedServiceLevel: Number(event.target.value) }))} /></label>
      </fieldset>
      <div className={styles.runbar}><div><span>Все вычисления выполняются локально в браузере</span><small>Файлы не отправляются во внешние сервисы</small></div><button disabled={!ready || running} onClick={run}>{running ? "ОБРАБОТКА…" : "РАССЧИТАТЬ ЗАКАЗЫ →"}</button></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>}

    {plan && <section className={styles.results}>
      <div className={styles.sectionHead}><span>02</span><div><p>Результат на {plan.asOfMonth}</p><h2>Рекомендации по поставщикам</h2></div><div className={styles.resultActions}><button className={styles.exportButton} disabled={!confirmedRows.length} onClick={downloadConfirmedOrders}>Скачать PO CSV ({confirmedRows.length})</button><button className={styles.reset} onClick={() => setPlan(undefined)}>Новый расчёт</button></div></div>
      <div className={styles.summary}>
        <div><small>ПОЗИЦИЙ</small><b>{plan.suppliers.reduce((sum, group) => sum + group.items.length, 0)}</b></div>
        <div><small>К ЗАКАЗУ</small><b>{number.format(plan.suppliers.reduce((sum, group) => sum + group.totalRecommendedUnits, 0))}</b></div>
        <div><small>СРОЧНЫХ</small><b>{plan.suppliers.flatMap((group) => group.items).filter((item) => item.urgency === "high").length}</b></div>
        <label><small>ПОИСК ПО SKU</small><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код или наименование" /></label>
      </div>
      <nav className={styles.exceptionBar} aria-label="Фильтр исключений">{exceptionViews.map((view) => {
        const count = plan.suppliers.flatMap((group) => group.items).filter((item) => matchesExceptionView(item, view.key)).length;
        return <button key={view.key} className={exceptionView === view.key ? styles.activeException : ""} onClick={() => setExceptionView(view.key)}>{view.label}<b>{count}</b></button>;
      })}</nav>
      {visible.map((group) => <article className={styles.resultGroup} key={group.supplier}>
        <header><div><span>ПОСТАВЩИК</span><h3>{group.supplier}</h3></div><b>{group.items.length} SKU · {number.format(group.totalRecommendedUnits)} ед.</b></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Артикул / наименование</th><th>Заказать</th><th>Срочность</th><th>Покрытие</th><th>Обоснование</th></tr></thead><tbody>
          {group.items.map((item) => {
            const narrativeKey = `${item.supplier}:${item.sku}`;
            const decision = decisions[narrativeKey] ?? { quantity: item.recommendedOrder, status: "draft" as const };
            return <tr key={item.sku}><td><b>{item.sku}</b><small>{item.productName}</small><span className={styles.pattern}>{demandPatternLabel[item.demandPattern]}</span>{item.stockLifecycleStatus !== "active" && <span className={`${styles.pattern} ${styles.lifecycleWarning}`}>{lifecycleLabel[item.stockLifecycleStatus]}</span>}</td><td className={styles.qty}>{number.format(item.recommendedOrder)}<small>MOQ {item.moqMultiple ?? "—"}</small>{item.stockLifecycleStatus === "dead" && <small className={styles.doNotOrder}>Не заказывать: спрос прекратился</small>}{item.isOverstock && item.recommendedOrder === 0 && <small className={styles.doNotOrder}>Не заказывать: запас превышает горизонт на {number.format(item.overstockMonths)} мес.</small>}{decision.status === "confirmed" && <small className={styles.confirmed}>Подтверждено: {number.format(decision.quantity)}</small>}</td><td><span className={`${styles.urgency} ${styles[item.urgency]}`}>{urgencyLabel[item.urgency]}</span></td><td><b>{item.daysOfSupply === null ? "—" : `${Math.round(item.daysOfSupply)} дн.`}</b><small>{item.daysOfSupply === null ? "Нет текущего спроса" : `товара хватит до ${item.projectedStockoutDate ?? "—"}`}</small></td><td><details><summary>Показать расчёт</summary><p>{explanation(item)}</p>{item.potentialStockoutDays !== null && item.potentialStockoutDays > 0 && <p className={styles.stockoutRisk}>Остаток закончится {item.projectedStockoutDate}, ближайшая поставка ожидается {item.nearestInboundExpectedDate}: {item.potentialStockoutDays} дн. потенциального дефицита.</p>}{item.isOverstock && <p className={styles.overstockNote}>{item.recommendedOrder === 0 ? `Автозаказ не требуется: совокупная позиция покрывает ${number.format(item.coverageMonths ?? 0)} мес. спроса.` : `Остаток покрывает ${number.format(item.coverageMonths ?? 0)} мес. спроса — выше обычного горизонта, но небольшой заказ всё ещё рекомендован из-за страхового запаса по волатильности этого SKU.`}</p>}{item.stockLifecycleStatus === "slow" && <p className={styles.assumption}>Slow stock: планирование переведено на средний спрос последних трёх доступных месяцев.</p>}{item.stockLifecycleStatus === "dead" && <p className={styles.stockoutRisk}>Dead stock: автоматическое пополнение заблокировано, рекомендация равна нулю.</p>}{item.unknownEtaExcluded && <p className={styles.assumption}>Поставка без точного ETA не уменьшает заказ. После подтверждения даты менеджер может пересчитать план.</p>}{narratives[narrativeKey] && <div className={styles.aiNarrative}><small>ОБЪЯСНЕНИЕ ИИ</small><p>{narratives[narrativeKey]}</p></div>}<div className={styles.decisionPanel}><label><small>КОЛИЧЕСТВО МЕНЕДЖЕРА</small><input type="number" min="0" step={item.moqMultiple ?? 1} value={decision.quantity} onChange={(event) => setDecisions((current) => ({ ...current, [narrativeKey]: { quantity: Math.max(0, Number(event.target.value) || 0), status: "draft" } }))} /></label><button onClick={() => setDecisions((current) => ({ ...current, [narrativeKey]: { quantity: validManagerQuantity(decision.quantity, item.moqMultiple), status: "confirmed" } }))}>Подтвердить</button></div><button className={styles.aiButton} disabled={narrating[narrativeKey]} onClick={() => requestNarrative(item)}>{narrating[narrativeKey] ? "ИИ формирует объяснение…" : "Получить объяснение от ИИ"}</button></details></td></tr>;
          })}
        </tbody></table></div>
      </article>)}
    </section>}
    <footer className={styles.footer}><span>HackAlem AI / ТОО «Электрокомплект»</span><span>Проверяемая модель · без скрытых вычислений</span></footer>
  </main>;
}
