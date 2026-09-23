import { test } from "node:test";
import assert from "node:assert/strict";
import { displayDomainLabel, displayLabel, relabelDomainEvidenceSummary, relabelFieldPrefix, relabelEvidenceSummary, statusLabel } from "./displayLabels.ts";
import { DOMAIN_PACKS } from "../domains/registry.ts";
import type { DomainPack } from "../domains/types.ts";

test("known construction and fintech field IDs map to a human-readable Russian label", () => {
  assert.equal(displayLabel("schedule_gap_pp"), "Отставание от графика, п.п.");
  assert.equal(displayLabel("usd_kzt"), "Курс USD/KZT");
  assert.equal(displayLabel("portfolio_risk"), "Совокупный риск кредитного портфеля");
  assert.equal(displayLabel("liquidity_stress"), "Дефицит ликвидности");
  assert.equal(displayLabel("default_risk"), "Кредитный риск");
  assert.equal(displayLabel("cash_flow"), "Денежный поток");
  assert.equal(displayLabel("payment_delays"), "Просроченные платежи");
  assert.equal(displayLabel("credit_utilization"), "Загрузка кредитных лимитов");
});

test("registered modern FinTech metrics use Domain Registry labels in Evidence presentation", () => {
  // No registered domain declares any overlapping `metrics` today — a synthetic RETAIL metric set
  // stands in for what a new domain's registered metrics would look like once added.
  const registry = DOMAIN_PACKS as Record<string, DomainPack>;
  const original = registry.RETAIL;
  const metricDef = (canonicalName: string, labelRu: string) => ({ canonicalName, labelRu, role: "context" as const, valueType: "continuous" as const, riskDirection: "neutral" as const, aliases: [] });
  registry.RETAIL = { ...original, metrics: {
    cost_of_funds: metricDef("cost_of_funds", "Стоимость фондирования"),
    default_rate: metricDef("default_rate", "Доля дефолтов"),
    delinquency_rate: metricDef("delinquency_rate", "Доля просрочки"),
  } };
  try {
    assert.equal(displayDomainLabel("cost_of_funds", "RETAIL"), "Стоимость фондирования");
    assert.equal(displayDomainLabel("default_rate", "RETAIL"), "Доля дефолтов");
    assert.equal(
      relabelDomainEvidenceSummary("cost_of_funds ↔ delinquency_rate: correlation 0.988 over 52 paired observations.", "RETAIL"),
      "Стоимость фондирования ↔ Доля просрочки: корреляция 0,988 по 52 парным наблюдениям.",
    );
  } finally { registry.RETAIL = original; }
});

test("relabelFieldPrefix rewrites the leading '<canonicalId>: ' token to its display label, and translates the tail into Russian when it matches a known deterministic-tool sentence", () => {
  assert.equal(
    relabelFieldPrefix("default_risk: 5/5 recent adjacent movements were non-decreasing."),
    "Кредитный риск: 5 из 5 последних смежных изменений были неснижающимися.",
  );
  assert.equal(
    relabelFieldPrefix("liquidity_stress: 5/5 recent adjacent movements were non-decreasing."),
    "Дефицит ликвидности: 5 из 5 последних смежных изменений были неснижающимися.",
  );
});

test("relabelFieldPrefix leaves an unrecognized tail untouched — it never guesses at a translation", () => {
  assert.equal(
    relabelFieldPrefix("schedule_gap_pp: recent trend widened by 1.2 points."),
    "Отставание от графика, п.п.: recent trend widened by 1.2 points.",
  );
});

test("relabelFieldPrefix leaves text with no leading identifier-colon pattern unchanged", () => {
  const free = "Correlation does not establish causality; alternative confounders not ruled out.";
  assert.equal(relabelFieldPrefix(free), free);
});

test("relabelFieldPrefix falls back to the generic prettifier for an unmapped leading ID", () => {
  assert.equal(relabelFieldPrefix("some_sensor: reading stable."), "Some sensor: reading stable.");
});

test("an unmapped field ID falls back to a prettified form instead of throwing or returning undefined", () => {
  assert.equal(displayLabel("some_uploaded_column"), "Some uploaded column");
  assert.equal(displayLabel("temperature"), "Temperature");
});

test("the mapping never returns a canonical snake_case ID unchanged for a known field", () => {
  for (const id of ["schedule_gap_pp", "usd_kzt", "planned_progress", "actual_progress", "payment_delays", "cash_flow", "liquidity_stress", "credit_utilization", "default_risk", "portfolio_risk"]) {
    assert.notEqual(displayLabel(id), id, `${id} must not be shown to the user as its raw canonical ID`);
  }
});

test("relabelEvidenceSummary rewrites a calculate_correlation-style 'A ↔ B: ...' evidence sentence into natural Russian", () => {
  assert.equal(
    relabelEvidenceSummary("portfolio_risk ↔ default_risk: correlation 0.998 over 24 paired observations."),
    "Совокупный риск кредитного портфеля ↔ Кредитный риск: корреляция 0,998 по 24 парным наблюдениям.",
  );
  assert.equal(
    relabelEvidenceSummary("liquidity_stress ↔ cash_flow: correlation -0.910 over 24 paired observations."),
    "Дефицит ликвидности ↔ Денежный поток: корреляция -0,910 по 24 парным наблюдениям.",
  );
});

test("relabelEvidenceSummary also handles the single-ID 'A: ...' evidence sentence (falls through to relabelFieldPrefix)", () => {
  assert.equal(
    relabelEvidenceSummary("default_risk: 5/5 recent adjacent movements were non-decreasing."),
    "Кредитный риск: 5 из 5 последних смежных изменений были неснижающимися.",
  );
  assert.equal(
    relabelEvidenceSummary("liquidity_stress: 5/5 recent adjacent movements were non-decreasing."),
    "Дефицит ликвидности: 5 из 5 последних смежных изменений были неснижающимися.",
  );
});

test("relabelEvidenceSummary preserves the exact digits of the evidence sentence — only the decimal separator becomes a Russian comma", () => {
  const rewritten = relabelEvidenceSummary("portfolio_risk ↔ default_risk: correlation 0.998 over 24 paired observations.");
  assert.match(rewritten, /0,998/, "the digits 0998 must survive, just with a comma instead of a period");
  assert.match(rewritten, /\b24\b/, "the paired-observation count must be unchanged");
  assert.doesNotMatch(rewritten, /\bcorrelation\b|\bpaired observations\b/i, "the English tail must have been translated, not left in place");
});

test("relabelEvidenceSummary does not mistake an Evidence ID (E-001) for a field ID", () => {
  const text = "E-001: portfolio_risk ↔ default_risk correlation summary.";
  assert.equal(relabelEvidenceSummary(text), text, "a hyphenated Evidence ID must never be relabeled or altered");
});

test("relabelFieldPrefix translates the construction tool pack's prefix-less deterministic sentences into Russian", () => {
  assert.equal(
    relabelFieldPrefix("USD/KZT changed from 472.0 to 519.8 (10.1%)."),
    "Курс USD/KZT изменился с 472,0 до 519,8 (10,1%).",
  );
  assert.equal(
    relabelFieldPrefix("Schedule gap 3.2 percentage points; recent widening 0.5."),
    "Отставание от графика: 3,2 п.п.; недавнее увеличение — 0,5.",
  );
  assert.equal(
    relabelFieldPrefix("Observed ordering is FX movement, price divergence, procurement pressure, delivery shortfall, then schedule deterioration."),
    "Наблюдаемая последовательность: изменение курса, расхождение цен, давление на закупки, недопоставка материалов, затем ухудшение графика.",
  );
});

test("relabelFieldPrefix leaves an unrecognized prefix-less sentence untouched — it never guesses at a translation", () => {
  const free = "Correlation does not establish causality; alternative confounders not ruled out.";
  assert.equal(relabelFieldPrefix(free), free);
});

test("statusLabel gives the Skeptic verdict a Russian label with the technical enum kept in parentheses — the same mapping the PDF report reuses", () => {
  assert.equal(statusLabel("SUPPORTED"), "Подтверждена (SUPPORTED)");
  assert.equal(statusLabel("CHALLENGED"), "Оспорена (CHALLENGED)");
  assert.equal(statusLabel("INCONCLUSIVE"), "Неопределённый результат (INCONCLUSIVE)");
});

test("relabelEvidenceSummary never mutates the string it is given (it returns a new display copy)", () => {
  const record = { id: "E-004", tool: "calculate_correlation", result: "portfolio_risk ↔ default_risk: correlation 0.998 over 24 paired observations.", variables: ["portfolio_risk", "default_risk"], usedBy: ["INVESTIGATOR"], data: {} };
  const original = record.result;
  const displayed = relabelEvidenceSummary(record.result);
  assert.notEqual(displayed, original, "the display copy should differ from the raw evidence text");
  assert.equal(record.result, original, "the underlying EvidenceRecord.result must remain the raw canonical text");
});
