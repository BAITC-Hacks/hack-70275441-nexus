import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bankClients } from "./fixtures.ts";
import { profileShape, periodTime } from "./profile.ts";
import { admitInvestigation, executeAdmitted } from "./admission.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import { syntheticConstructionDataset } from "../construction/dataset.ts";
import { syntheticIndustrialDataset } from "../demo/syntheticIndustrial.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

const ambiguous: UploadedDataset = { name: "numbers.csv", columns: ["value"], rows: [{ value: 1 }, { value: 2 }, { value: 3 }] };
const events: UploadedDataset = { name: "events.csv", columns: ["event_id", "timestamp", "user_id", "action", "bytes"], rows: [1, 2, 3].map((i) => ({ event_id: `E${i}`, timestamp: `2026-01-0${i}`, user_id: "alice", action: "login", bytes: i })) };
test("bank clients reroute to cross-sectional workflow but cannot enter the time-series orchestrator callback", () => {
  const request = { dataset: bankClients, signals: ["risk_score"] };
  assert.equal(profileShape(bankClients).tag, "CROSS_SECTIONAL");
  assert.deepEqual({ status: admitInvestigation(request).status, workflowId: admitInvestigation(request).workflowId }, { status: "PROCEED", workflowId: "cross-sectional-investigation" });
  let orchestratorEntries = 0;
  assert.throws(() => executeAdmitted(request, () => { orchestratorEntries++; }));
  assert.equal(orchestratorEntries, 0);
});
test("numeric-only data requires input, never temporal admission", () => {
  assert.equal(profileShape(ambiguous).tag, "AMBIGUOUS_TABULAR");
  assert.equal(admitInvestigation({ dataset: ambiguous, signals: ["value"] }).status, "NEEDS_INPUT");
});
for (const dataset of [fintechDemoDataset(), syntheticConstructionDataset(), syntheticIndustrialDataset()]) {
  test(`${dataset.name}: baseline temporal input reaches the unchanged execution callback`, () => {
    const shape = profileShape(dataset);
    assert.equal(shape.tag, "TIME_SERIES");
    const request = { dataset, signals: shape.measures };
    assert.equal(admitInvestigation(request).status, "PROCEED");
    const snapshot = JSON.stringify(dataset);
    let calls = 0;
    const originalResult = { unchanged: true };
    assert.equal(executeAdmitted(request, () => { calls++; return originalResult; }), originalResult);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(dataset), snapshot);
  });
}
test("event identity plus timestamps and action semantics routes to event workflow while blocking precursor execution", () => {
  assert.equal(profileShape(events).tag, "EVENT_TRANSACTION");
  assert.deepEqual({ status: admitInvestigation({ dataset: events, signals: ["bytes"] }).status, workflowId: admitInvestigation({ dataset: events, signals: ["bytes"] }).workflowId }, { status: "PROCEED", workflowId: "event-transaction-investigation" });
  assert.throws(() => executeAdmitted({ dataset: events, signals: ["bytes"] }, () => assert.fail("must not execute")));
});
test("repeatable decisions; unknown tasks and unsupported intents never fall through", () => {
  const request = { dataset: fintechDemoDataset(), signals: ["cash_flow"] };
  assert.deepEqual(admitInvestigation(request), admitInvestigation(request));
  for (const taskId of ["unknown", "education-match", "cybersecurity"]) assert.equal(admitInvestigation({ ...request, taskId }).status, "UNSUPPORTED");
  for (const intent of ["SCORE", "ANALYZE", "unknown"]) assert.equal(admitInvestigation({ ...request, intent }).status, "UNSUPPORTED");
});
test("date names, unique clients with dates, invalid mappings and unordered periods cannot authorize time series", () => {
  const datedClients = { ...bankClients, columns: [...bankClients.columns, "date"], rows: bankClients.rows.map((row, i) => ({ ...row, date: `2026-01-${String(i + 1).padStart(2, "0")}` })) };
  assert.notEqual(profileShape(datedClients).tag, "TIME_SERIES");
  assert.notEqual(profileShape({ ...ambiguous, columns: ["date"], rows: [{ date: 1 }, { date: 2 }, { date: 3 }] }).tag, "TIME_SERIES");
  assert.equal(admitInvestigation({ dataset: fintechDemoDataset(), signals: ["cash_flow"], mapping: { date: "cash_flow" } }).status, "NEEDS_INPUT");
  const reversed = fintechDemoDataset(); reversed.rows.reverse();
  assert.equal(profileShape(reversed).tag, "AMBIGUOUS_TABULAR");
  assert.equal(periodTime("2026-02-30"), null);
  assert.equal(periodTime("2026-W99"), null);
});
test("day-first calendar dates (DD.MM.YYYY / DD/MM/YYYY) and thousands-separated numbers admit a real-world unfamiliar file as TIME_SERIES", () => {
  assert.equal(periodTime("06.01.2025"), Date.UTC(2025, 0, 6));
  assert.equal(periodTime("06/01/2025"), Date.UTC(2025, 0, 6));
  assert.equal(periodTime("6.1.2025"), Date.UTC(2025, 0, 6));
  assert.equal(periodTime("31.02.2025"), null, "31 February does not exist");
  assert.equal(periodTime("29.02.2025"), null, "2025 is not a leap year");
  assert.equal(periodTime("29.02.2024"), Date.UTC(2024, 1, 29), "2024 is a leap year");
  assert.equal(periodTime("06.01/2025"), null, "mismatched separators must not match");
  assert.equal(periodTime(46246.812130162034), null, "numbers are still never interpreted as epoch/serial dates");
  assert.equal(periodTime("46246.812130162034"), null, "an Excel date serial rendered as text is still not a day-first calendar date");

  // Unambiguous, strictly increasing weekly DD.MM.YYYY dates, plus a space-thousands revenue column
  // shaped exactly like the reported real-world unfamiliar Excel export.
  const rows = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 0, 6) + i * 7 * 86400000);
    return {
      "Дата отчёта": `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`,
      "Выручка, тыс.тг": (1500 + i * 37).toLocaleString("ru-RU"),
      // one genuinely missing cell partway through, exactly like the reported real-world file
      "Средний чек": i === 5 ? "" : 180 + i,
    };
  });
  const dataset = { name: "unfamiliar.csv", columns: ["Дата отчёта", "Выручка, тыс.тг", "Средний чек"], rows };
  const shape = profileShape(dataset, "Дата отчёта");
  assert.equal(shape.tag, "TIME_SERIES", "an unfamiliar file with day-first dates, space-thousands numbers and one missing cell must not get stuck at AMBIGUOUS_TABULAR");
  assert.ok(shape.measures.includes("Выручка, тыс.тг"), "the thousands-separated revenue column must be recognized as numeric");
  assert.ok(shape.measures.includes("Средний чек"), "a single missing cell must not disqualify an otherwise-numeric column from being a measure");
});
test("bare Russian period/month/week column names auto-detect as the time axis without manual selection", () => {
  for (const columnName of ["Период", "Месяц", "Неделя"]) {
    const rows = Array.from({ length: 4 }, (_, i) => ({ [columnName]: `2025-0${i + 1}-01`, "Выручка": 100 + i }));
    const dataset = { name: "x.csv", columns: [columnName, "Выручка"], rows };
    const shape = profileShape(dataset);
    assert.equal(shape.tag, "TIME_SERIES", `"${columnName}" must be auto-detected as the time column without selectedDate`);
    assert.equal(shape.timeColumn, columnName);
  }
});
test("a numeric column tolerates a missing cell but not a genuinely non-numeric one, and an all-missing column is never a measure", () => {
  const columns = ["date", "mostly_numeric", "one_bad_cell", "all_missing"];
  const rows = Array.from({ length: 5 }, (_, i) => ({
    date: `2025-01-0${i + 1}`,
    mostly_numeric: i === 2 ? "" : i,
    one_bad_cell: i === 2 ? "n/a" : i,
    all_missing: "",
  }));
  const shape = profileShape({ name: "x.csv", columns, rows }, "date");
  assert.ok(shape.measures.includes("mostly_numeric"), "one missing cell among otherwise-numeric values is still a valid measure");
  assert.ok(!shape.measures.includes("one_bad_cell"), "a genuinely non-numeric present value still disqualifies the column");
  assert.ok(!shape.measures.includes("all_missing"), "a column with no numeric values at all is never a measure");
});
test("API invocation of the old orchestrator is inside the tested gate and rejects before streaming", () => {
  const api = readFileSync(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.match(api, /executeAdmitted\(admissionRequest, \(\) => runAgenticInvestigation\(/);
  assert.ok(api.indexOf('routeDecision.status !== "PROCEED"') < api.indexOf("new ReadableStream"));
  const orchestrator = readFileSync(new URL("../agentic/orchestrator.ts", import.meta.url), "utf8");
  assert.ok(orchestrator.indexOf("executeAdmitted({") < orchestrator.indexOf("const analysis = analyzeGeneric"));
});
