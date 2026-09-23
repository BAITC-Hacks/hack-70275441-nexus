import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { normalizeTabularRows } from "../ingestion/normalizeTabularRows.ts";
import { profileDataset } from "../ingestion/profileDataset.ts";
import { admitInvestigation } from "../universal/admission.ts";
import { normalizeHeader } from "../universal/headers.ts";
import { periodTime } from "../universal/profile.ts";
import { eventActivityFixture, russianBankClients60 } from "../universal/fixtures.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import { resolveEventSemantics } from "./tools.ts";
import { runEventTransactionInvestigation } from "./workflow.ts";
import type { EventAgentRuns } from "./agents.ts";

const headers = ["ID транзакции", "Дата и время", "ID клиента", "ФИО клиента", "№ счёта", "Тип операции", "Сумма", "Валюта", "Назначение платежа", "Канал", "Статус"];
const rows = Array.from({ length: 131 }, (_, i) => [`TXN-${String(i + 1).padStart(5, "0")}`, new Date(Date.UTC(2026, 7, 12, 14, 29, 17, 46) + i * 60000), `CUST-${i % 8}`, "Тестовый клиент", "****1234", ["Перевод входящий", "Снятие наличных", "Оплата товара/услуги"][i % 3], 1000 + i, "KZT", "Тестовый платёж", "POS-терминал", "Успешно"]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Transactions");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
function parse(cellDates: boolean) {
  const parsed = XLSX.read(bytes, { type: "array", cellDates });
  return XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
}
const parsed = parse(true);
const dataset = JSON.parse(JSON.stringify({ name: "transaction_journal.xlsx", columns: headers, rows: normalizeTabularRows(parsed) }));
const fallback = async (): Promise<EventAgentRuns> => ({ llmCalls: 0, agentCalls: [], investigator: { source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "Published evidence warrants review.", alternativeExplanation: "Normal batching remains plausible.", rationale: "Evidence only.", evidenceRefs: ["E-007"] }, skeptic: { source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Timestamp quality and batching need review.", alternativeExplanation: "Normal processing remains plausible.", evidenceRefs: ["E-004"] } });

test("exact Russian 131-row journal survives Excel Date to JSON to event admission", () => {
  assert.equal(typeof parse(false)[1][1], "number");
  assert.ok(parsed[1][1] instanceof Date);
  assert.equal(dataset.rows.length, 131);
  assert.deepEqual(Object.keys(dataset.rows[0]), headers);
  assert.match(dataset.rows[0]["Дата и время"], /^2026-08-12T14:29:17\.04\dZ$/);
  assert.deepEqual(headers.map(h => normalizeHeader(h).semanticRole), ["EVENT_ID", "EVENT_TIMESTAMP", "ENTITY_ID", "OTHER", "OTHER", "EVENT_TYPE", "EVENT_VALUE", "OTHER", "OTHER", "OTHER", "EVENT_TYPE"]);
  assert.deepEqual(headers.map(h => normalizeHeader(h).normalizedName), ["id транзакции", "дата и время", "id клиента", "фио клиента", "no счёта", "тип операции", "сумма", "валюта", "назначение платежа", "канал", "статус"]);
  assert.deepEqual(resolveEventSemantics(dataset), { eventIdColumn: headers[0], timestampColumn: headers[1], entityColumn: headers[2], eventTypeColumn: headers[5], valueColumn: headers[6] });
  assert.deepEqual(profileDataset(dataset).numericColumns, ["Сумма"]);
  const route = admitInvestigation({ dataset, signals: ["Сумма"], intent: "INVESTIGATE" });
  assert.equal(route.shape.tag, "EVENT_TRANSACTION"); assert.equal(route.status, "PROCEED"); assert.equal(route.workflowId, "event-transaction-investigation"); assert.deepEqual(route.missingRequirements, []);
});

test("Excel-like calendar text is deterministic UTC and invalid values remain rejected", () => {
  assert.equal(periodTime("2026-08-12 14:29:17.046"), Date.UTC(2026, 7, 12, 14, 29, 17, 46));
  for (const value of [46246.812130162034, "46246.812130162034", "yesterday", "2026-02-30 14:29:17.046", "2026-08-12 24:00:00", "2026-13", "2026-08-12T14:29:17+25:00"]) assert.equal(periodTime(value), null);
  const textDataset = { ...dataset, rows: dataset.rows.map((row: Record<string, unknown>) => ({ ...row, "Дата и время": "2026-08-12 14:29:17.046" })) };
  assert.equal(admitInvestigation({ dataset: textDataset, signals: [] }).workflowId, "event-transaction-investigation");
});

test("journal workflow independently validates and executes only event tools", async () => {
  const result = await runEventTransactionInvestigation({ dataset, signals: ["Сумма"] }, fallback);
  assert.equal(result.validation.status, "VALIDATED"); assert.ok(result.validation.checks.every(c => c.passed));
  assert.equal(result.artifact.analysis.dataset.eventCount, 131);
  assert.ok(result.artifact.evidence.every(e => !/series|directional|precursor|lag|cross_sectional|association/i.test(e.tool)));
});

test("existing bank, fintech, ambiguous numeric and English event routes are preserved", () => {
  assert.equal(admitInvestigation({ dataset: russianBankClients60, signals: ["Риск-балл"] }).shape.tag, "CROSS_SECTIONAL");
  const fintech = fintechDemoDataset();
  assert.equal(admitInvestigation({ dataset: fintech, signals: ["default_rate"] }).shape.tag, "TIME_SERIES");
  const route = admitInvestigation({ dataset: { name: "numeric.csv", columns: ["value"], rows: [1, 2, 3].map(value => ({ value })) }, signals: ["value"] });
  assert.equal(route.status, "NEEDS_INPUT"); assert.ok(!route.missingRequirements.some(r => /three|periods/i.test(r)));
  assert.equal(admitInvestigation({ dataset: eventActivityFixture, signals: [] }).workflowId, "event-transaction-investigation");
});

test("preview explicitly gates time-series terminology on admitted shape", () => {
  const ui = readFileSync("components/nexus/workspace/InvestigationWorkspace.tsx", "utf8");
  assert.ok(ui.includes('const isTimeSeries = routeDecision?.shape.tag === "TIME_SERIES"'));
  assert.ok(ui.includes('isTimeSeries ? "Самый аномальный сигнал" : "Не применяется до подтверждения структуры"'));
  assert.ok(ui.includes('isTimeSeries ? "NEXUS рассчитает описательную статистику, лаговые связи'));
  assert.ok(ui.includes('timeSeries ? "ПЕРИОД" : "СТРУКТУРА"'));
  assert.ok(ui.includes('timeSeries && <div><dt>ЧАСТОТА'));
  assert.ok(ui.includes('cellDates: true'));
});
