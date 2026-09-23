"use client";

import { useMemo, useState } from "react";
import { assembleReplenishmentInput, DEFAULT_ASSEMBLY_ASSUMPTIONS, type SupplierParsedData } from "@/lib/nexus/replenishment/assemble";
import { calculateReplenishment, type ReplenishmentPlan, type ReplenishmentRecommendation } from "@/lib/nexus/replenishment/calculation";
import type { ReplenishmentNarrationInput } from "@/lib/nexus/replenishment/narration";
import { parseInboundShipments, parseMinimumOrderQuantities, parseMonthlyOpeningStock, parseMonthlySales, parseSalesTransactions, parseSkuCategories, parseSkuReservations } from "@/lib/nexus/replenishment/xlsxParsers";
import styles from "./replenishment.module.css";

type FileKind = "transactions" | "monthlySales" | "openingStocks" | "inbound" | "moq";
type SupplierKey = "iek" | "systeme";
type FilesState = Record<SupplierKey, Partial<Record<FileKind, File>>>;

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
    ...(key === "systeme" ? { categories: parseSkuCategories(inbound), reservations: parseSkuReservations(inbound) } : { reservations: [] }),
  };
}

function explanation(item: ReplenishmentRecommendation): string {
  return `Базовый спрос ${number.format(item.baseMonthlyDemand)} ед./мес.; сезонность ×${number.format(item.seasonalIndex)}; исторический рост ${percent.format(item.historicalGrowthRate)}; внешний прогноз ${percent.format(item.forecastGrowthRate)}. Поправка stockout: +${number.format(item.stockoutAdjustmentUnitsPerMonth)} ед./мес. (${item.stockoutMonths.length} мес.); исключено всплесков: ${item.excludedSpikeCount} на ${number.format(item.excludedSpikeUnits)} ед. Страховой запас ${number.format(item.safetyStock)} = z ${number.format(item.safetyStockZScore)} × σ ${number.format(item.demandStdDev)} × √горизонта, уровень сервиса ${percent.format(item.serviceLevel)}. Позиция: остаток ${number.format(item.currentStock)} − резерв ${number.format(item.reservedStock)} + в пути ${number.format(item.goodsInTransitWithinHorizon)}; доступный остаток ${number.format(item.availableStock)}, целевой уровень ${number.format(item.targetPosition)}.`;
}

function narrationInput(item: ReplenishmentRecommendation): ReplenishmentNarrationInput {
  const {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, currentStock, reservedStock, availableStock, goodsInTransitWithinHorizon,
    demandStdDev, serviceLevel, safetyStockZScore, safetyStock, targetPosition, currentPosition,
    recommendedOrder, urgency,
  } = item;
  return {
    sku, productName, supplier, category, baseMonthlyDemand, seasonalIndex, historicalGrowthRate,
    forecastGrowthRate, stockoutAdjustmentUnitsPerMonth, stockoutMonths, excludedSpikeCount,
    excludedSpikeUnits, currentStock, reservedStock, availableStock, goodsInTransitWithinHorizon,
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
  const selectedCount = Object.values(files).flatMap((group) => Object.values(group)).length;
  const ready = selectedCount === FILE_FIELDS.length * SUPPLIERS.length;

  const visible = useMemo(() => plan?.suppliers.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.sku} ${item.productName}`.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))).sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || b.recommendedOrder - a.recommendedOrder),
  })) ?? [], [plan, query]);

  const run = async () => {
    setRunning(true); setError(""); setPlan(undefined);
    try {
      // Yield once so the pending state paints before large partner workbooks are decoded.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const parsed = await Promise.all(SUPPLIERS.map((supplier) => parseSupplier(supplier.key, files[supplier.key])));
      setPlan(calculateReplenishment(assembleReplenishmentInput(parsed, DEFAULT_ASSEMBLY_ASSUMPTIONS)));
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
      <div className={styles.runbar}><div><span>Все вычисления выполняются локально в браузере</span><small>Файлы не отправляются во внешние сервисы</small></div><button disabled={!ready || running} onClick={run}>{running ? "ОБРАБОТКА…" : "РАССЧИТАТЬ ЗАКАЗЫ →"}</button></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>}

    {plan && <section className={styles.results}>
      <div className={styles.sectionHead}><span>02</span><div><p>Результат на {plan.asOfMonth}</p><h2>Рекомендации по поставщикам</h2></div><button className={styles.reset} onClick={() => setPlan(undefined)}>Новый расчёт</button></div>
      <div className={styles.summary}>
        <div><small>ПОЗИЦИЙ</small><b>{plan.suppliers.reduce((sum, group) => sum + group.items.length, 0)}</b></div>
        <div><small>К ЗАКАЗУ</small><b>{number.format(plan.suppliers.reduce((sum, group) => sum + group.totalRecommendedUnits, 0))}</b></div>
        <div><small>СРОЧНЫХ</small><b>{plan.suppliers.flatMap((group) => group.items).filter((item) => item.urgency === "high").length}</b></div>
        <label><small>ПОИСК ПО SKU</small><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код или наименование" /></label>
      </div>
      {visible.map((group) => <article className={styles.resultGroup} key={group.supplier}>
        <header><div><span>ПОСТАВЩИК</span><h3>{group.supplier}</h3></div><b>{group.items.length} SKU · {number.format(group.totalRecommendedUnits)} ед.</b></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Артикул / наименование</th><th>Заказать</th><th>Срочность</th><th>Покрытие</th><th>Обоснование</th></tr></thead><tbody>
          {group.items.map((item) => {
            const narrativeKey = `${item.supplier}:${item.sku}`;
            return <tr key={item.sku}><td><b>{item.sku}</b><small>{item.productName}</small></td><td className={styles.qty}>{number.format(item.recommendedOrder)}<small>MOQ {item.moqMultiple ?? "—"}</small></td><td><span className={`${styles.urgency} ${styles[item.urgency]}`}>{urgencyLabel[item.urgency]}</span></td><td>{item.coverageMonths === null ? "—" : `${number.format(item.coverageMonths)} мес.`}</td><td><details><summary>Показать расчёт</summary><p>{explanation(item)}</p>{narratives[narrativeKey] && <div className={styles.aiNarrative}><small>ОБЪЯСНЕНИЕ ИИ</small><p>{narratives[narrativeKey]}</p></div>}<button className={styles.aiButton} disabled={narrating[narrativeKey]} onClick={() => requestNarrative(item)}>{narrating[narrativeKey] ? "ИИ формирует объяснение…" : "Получить объяснение от ИИ"}</button></details></td></tr>;
          })}
        </tbody></table></div>
      </article>)}
    </section>}
    <footer className={styles.footer}><span>HackAlem AI / ТОО «Электрокомплект»</span><span>Проверяемая модель · без скрытых вычислений</span></footer>
  </main>;
}
