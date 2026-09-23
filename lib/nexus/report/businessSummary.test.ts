import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBusinessSummary } from "./businessSummary.ts";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { AgenticResult } from "@/lib/nexus/agentic/types";

const analysis = {
  findings: [
    { column: "payment_delays", latest: 6.1, mean: 4, standardDeviation: 1, zScore: 2.1, observationCount: 24, missingPercent: 0, direction: "rising" as const },
    { column: "cash_flow", latest: 76, mean: 95, standardDeviation: 8, zScore: -2.4, observationCount: 24, missingPercent: 0, direction: "falling" as const },
  ],
} as unknown as GenericAnalysis;

const agentic = {
  observerFindings: ["payment_delays: rose from 3.1 to 6.1 across 24 observations."],
  precursorChain: {
    edges: [
      { from: "payment_delays", to: "portfolio_risk", correlation: 0.93, lagPeriods: 2, n: 22, ci95: { lower: 0.84, upper: 0.97 }, pValue: 0.0001, significant: true, allLags: [], bootstrap: null },
      { from: "cash_flow", to: "portfolio_risk", correlation: -0.88, lagPeriods: 1, n: 23, ci95: null, pValue: null, significant: false, allLags: [], bootstrap: null },
    ],
    riskIndicator: 0.72,
    riskLabel: "HIGH" as const,
    causality: "NOT_ESTABLISHED" as const,
    methodologyNotes: [],
  },
} as unknown as AgenticResult;

test("the business summary names the outcome, the strongest leading signal, its lag and its sample size — as display labels, not canonical IDs", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  assert.match(summary.headline, /Совокупный риск кредитного портфеля/);
  assert.match(summary.headline, /Просроченные платежи/);
  assert.doesNotMatch(summary.headline, /portfolio_risk/);
  assert.doesNotMatch(summary.headline, /payment_delays/);
  assert.match(summary.headline, /опережает его на 2 периода/);
  assert.match(summary.headline, /22 парным наблюдениям/);
});

test("the leading canonical ID on an observer finding is relabeled for display without altering the rest of the sentence", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  assert.equal(summary.findings[0], "Просроченные платежи: rose from 3.1 to 6.1 across 24 observations.");
});

test("no finding — observer-derived or edge-derived — leaks a raw canonical field ID into the user-facing Result", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  const joined = summary.findings.join(" ");
  assert.match(joined, /Просроченные платежи → Совокупный риск кредитного портфеля/);
  assert.match(joined, /Денежный поток → Совокупный риск кредитного портфеля/);
  assert.doesNotMatch(joined, /\bpayment_delays\b|\bcash_flow\b|\bportfolio_risk\b/);
});

test("a lag of 0 is reported as co-movement, never as a lead", () => {
  const simultaneous = { ...agentic, precursorChain: { ...agentic.precursorChain, edges: [{ ...agentic.precursorChain.edges[0], lagPeriods: 0 }] } } as unknown as AgenticResult;
  const summary = buildBusinessSummary(analysis, simultaneous);
  assert.match(summary.headline, /движется синхронно с ним, без измеримого опережения/);
  assert.doesNotMatch(summary.headline, /опережает его на 0/);
  assert.match(summary.findings.join(" "), /измеримое временное опережение не выявлено/);
});

test("the business summary never claims causality or forecasts an event", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  const text = `${summary.headline} ${summary.whyItMatters} ${summary.findings.join(" ")}`;
  assert.doesNotMatch(text, /\bprobability\b/i);
  assert.doesNotMatch(text, /\bcaused by\b|\bcauses\b|\bwill cause\b/i);
  assert.doesNotMatch(text, /\bpredict/i, "the summary must not present itself as a forecast");
  assert.match(summary.whyItMatters, /не устанавливает, что один вызвал другой/);
  assert.match(summary.whyItMatters, /не является прогнозом/);
});

test("with no computed chain the summary says so instead of inventing a risk story", () => {
  const empty = { observerFindings: [], precursorChain: { edges: [], riskIndicator: 0, riskLabel: "LOW" as const, causality: "NOT_ESTABLISHED" as const, methodologyNotes: [] } } as unknown as AgenticResult;
  const summary = buildBusinessSummary({ findings: [] } as unknown as GenericAnalysis, empty);
  assert.match(summary.headline, /Ни один сигнал в этом наборе данных не отклоняется/);
  assert.match(summary.whyItMatters, /поддерживает только мониторинг/);
});

test("findings report the Holm-corrected significance of each shown edge rather than hiding it", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  const joined = summary.findings.join(" ");
  assert.match(joined, /результат сохраняет статистическую значимость после поправки Холма/);
  assert.match(joined, /результат не достиг статистической значимости после поправки Холма/);
});

test("statistical sentences use a Russian decimal comma and preserve every number unchanged", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  const joined = summary.findings.join(" ");
  assert.match(joined, /r = 0,93/);
  assert.match(joined, /r = -0,88/);
  assert.doesNotMatch(joined, /r = 0\.93|r = -0\.88/);
});

const constructionAnalysis = {
  findings: [
    { column: "usd_kzt", latest: 520, mean: 480, standardDeviation: 10, zScore: 2.5, observationCount: 24, missingPercent: 0, direction: "rising" as const },
  ],
} as unknown as GenericAnalysis;

const constructionAgentic = {
  observerFindings: ["usd_kzt: 5/5 recent adjacent movements were non-decreasing."],
  precursorChain: {
    edges: [
      { from: "planned_progress", to: "schedule_gap_pp", correlation: 0.98, lagPeriods: 3, n: 21, ci95: { lower: 0.9, upper: 0.99 }, pValue: 0.0001, significant: true, allLags: [], bootstrap: null },
      { from: "usd_kzt", to: "schedule_gap_pp", correlation: 0.9, lagPeriods: 0, n: 24, ci95: null, pValue: null, significant: false, allLags: [], bootstrap: null },
    ],
    riskIndicator: 0.67,
    riskLabel: "HIGH" as const,
    causality: "NOT_ESTABLISHED" as const,
    methodologyNotes: [],
  },
} as unknown as AgenticResult;

test("the business summary never leaks the known English business-template fragments reported from production", () => {
  const summary = buildBusinessSummary(analysis, agentic);
  const text = `${summary.headline} ${summary.whyItMatters} ${summary.findings.join(" ")}`;
  for (const fragment of [
    "is the outcome under investigation",
    "with no measurable lead",
    "significant after Holm correction",
    "Several signals move closely with the outcome",
    "paired observations",
    "leads it by",
  ]) {
    assert.doesNotMatch(text, new RegExp(fragment), `"${fragment}" is a known English template fragment and must not reappear in the business summary`);
  }
});

test("Construction: no canonical field ID (schedule_gap_pp, usd_kzt, planned_progress, actual_progress) leaks into the headline or findings", () => {
  const summary = buildBusinessSummary(constructionAnalysis, constructionAgentic);
  const text = `${summary.headline} ${summary.findings.join(" ")}`;
  assert.match(text, /Отставание от графика, п\.п\./);
  assert.match(text, /Плановый прогресс, %/);
  assert.match(text, /Курс USD\/KZT/);
  assert.doesNotMatch(text, /\bschedule_gap_pp\b|\busd_kzt\b|\bplanned_progress\b|\bactual_progress\b/);
  // The observer finding's leading canonical ID is relabeled, and its known deterministic tail is translated to Russian.
  assert.equal(summary.findings[0], "Курс USD/KZT: 5 из 5 последних смежных изменений были неснижающимися.");
});

const logisticsAnalysis = {
  findings: [
    { column: "fuel_cost", latest: 520, mean: 480, standardDeviation: 10, zScore: 2.5, observationCount: 24, missingPercent: 0, direction: "rising" as const },
  ],
} as unknown as GenericAnalysis;

const logisticsAgentic = {
  observerFindings: ["on_time_delivery_rate: 0/5 recent adjacent movements were non-decreasing."],
  precursorChain: {
    edges: [
      { from: "fuel_cost", to: "delivery_delay", correlation: 0.91, lagPeriods: 2, n: 22, ci95: { lower: 0.8, upper: 0.96 }, pValue: 0.0002, significant: true, allLags: [], bootstrap: null },
    ],
    riskIndicator: 0.7,
    riskLabel: "HIGH" as const,
    causality: "NOT_ESTABLISHED" as const,
    methodologyNotes: [],
  },
} as unknown as AgenticResult;

test("with a domainId, canonical IDs resolve through the Domain Registry's Russian labels instead of the generic prettified fallback", () => {
  const summary = buildBusinessSummary(logisticsAnalysis, logisticsAgentic, "LOGISTICS");
  const text = `${summary.headline} ${summary.findings.join(" ")}`;
  assert.match(text, /Стоимость топлива/);
  assert.match(text, /Задержка доставки/);
  assert.equal(summary.findings[0], "Доля своевременных поставок: 0 из 5 последних смежных изменений были неснижающимися.");
  assert.doesNotMatch(text, /\bfuel_cost\b|\bdelivery_delay\b|\bon_time_delivery_rate\b|Fuel cost|Delivery delay|On time delivery rate/);
});
