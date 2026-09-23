import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNextSteps } from "./nextSteps.ts";
import { DOMAIN_PACKS } from "../domains/registry.ts";
import type { DomainPack } from "../domains/types.ts";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import type { PrecursorChain } from "./types";

const dataset: UploadedDataset = { name: "fixture.csv", columns: ["default_risk", "liquidity_stress"], rows: Array.from({ length: 24 }, () => ({})) };

const analysis = {
  profile: {
    columns: [
      { name: "default_risk", kind: "numeric", missing: 0, missingPercent: 15, unique: 24 },
      { name: "liquidity_stress", kind: "numeric", missing: 0, missingPercent: 2, unique: 24 },
    ],
  },
} as unknown as GenericAnalysis;

const highRiskChain = {
  edges: [
    { from: "default_risk", to: "portfolio_risk", correlation: 0.95, lagPeriods: 1, n: 22, ci95: null, pValue: null, significant: true, allLags: [], bootstrap: null },
    { from: "liquidity_stress", to: "portfolio_risk", correlation: 0.9, lagPeriods: 0, n: 24, ci95: null, pValue: null, significant: false, allLags: [], bootstrap: null },
  ],
  riskIndicator: 0.7,
  riskLabel: "HIGH" as const,
  causality: "NOT_ESTABLISHED" as const,
  methodologyNotes: [],
} as unknown as PrecursorChain;

test("the HIGH-risk recommendation names the leading edges by display label, not canonical field ID", () => {
  const steps = buildNextSteps(dataset, analysis, highRiskChain);
  const joined = steps.join(" ");
  assert.match(joined, /Кредитный риск/);
  assert.match(joined, /Дефицит ликвидности/);
  assert.doesNotMatch(joined, /\bdefault_risk\b|\bliquidity_stress\b|\bportfolio_risk\b/);
});

test("the data-quality recommendation names a high-missingness column by display label", () => {
  const steps = buildNextSteps(dataset, analysis, highRiskChain);
  const joined = steps.join(" ");
  assert.match(joined, /Проверьте качество данных по показателю "Кредитный риск"/);
  assert.doesNotMatch(joined, /"default_risk"/);
});

test("next steps never leak the old English recommendation templates", () => {
  const steps = buildNextSteps(dataset, analysis, highRiskChain).join(" ");
  for (const fragment of [
    "Collect more observations",
    "Verify data quality for",
    "Prioritize human review of",
    "No strong precursor pattern",
    "not an automated decision",
  ]) {
    assert.doesNotMatch(steps, new RegExp(fragment), `"${fragment}" is a known English next-step template fragment and must not reappear`);
  }
  assert.match(steps, /[А-Яа-яЁё]/, "next steps must contain Russian text");
});

test("with a known domainId, the HIGH-risk recommendation uses Domain Registry labels instead of the generic English fallback", () => {
  // No registered domain declares any `metrics` overlapping this fixture today — a synthetic RETAIL
  // metric set stands in for what a new domain's registered metrics would look like once added.
  const registry = DOMAIN_PACKS as Record<string, DomainPack>;
  const original = registry.RETAIL;
  const metricDef = (canonicalName: string, labelRu: string) => ({ canonicalName, labelRu, role: "context" as const, valueType: "continuous" as const, riskDirection: "neutral" as const, aliases: [] });
  registry.RETAIL = { ...original, metrics: {
    cost_of_funds: metricDef("cost_of_funds", "Стоимость фондирования"),
    loan_portfolio: metricDef("loan_portfolio", "Кредитный портфель"),
    delinquency_rate: metricDef("delinquency_rate", "Доля просрочки"),
    profit: metricDef("profit", "Прибыль"),
  } };
  try {
    const fintechDataset: UploadedDataset = { name: "fintech.csv", columns: ["cost_of_funds", "loan_portfolio", "delinquency_rate", "profit"], rows: Array.from({ length: 52 }, () => ({})) };
    const fintechAnalysis = { profile: { columns: fintechDataset.columns.map((name) => ({ name, kind: "numeric", missing: 0, missingPercent: 0, unique: 52 })) } } as unknown as GenericAnalysis;
    const chain = { ...highRiskChain, edges: [
      { from: "cost_of_funds", to: "default_rate", correlation: 0.99, lagPeriods: 3, n: 49, ci95: null, pValue: null, significant: true, allLags: [], bootstrap: null },
      { from: "loan_portfolio", to: "default_rate", correlation: 0.95, lagPeriods: 3, n: 49, ci95: null, pValue: null, significant: true, allLags: [], bootstrap: null },
      { from: "delinquency_rate", to: "default_rate", correlation: 0.99, lagPeriods: 2, n: 50, ci95: null, pValue: null, significant: true, allLags: [], bootstrap: null },
      { from: "profit", to: "default_rate", correlation: 0.25, lagPeriods: 2, n: 50, ci95: null, pValue: null, significant: false, allLags: [], bootstrap: null },
    ] } as unknown as PrecursorChain;
    const withoutDomain = buildNextSteps(fintechDataset, fintechAnalysis, chain).join(" ");
    assert.match(withoutDomain, /Cost of funds/, "sanity check: without a domainId, the generic prettifier is unchanged");
    const withDomain = buildNextSteps(fintechDataset, fintechAnalysis, chain, "RETAIL").join(" ");
    assert.match(withDomain, /Стоимость фондирования/);
    assert.match(withDomain, /Кредитный портфель/);
    assert.match(withDomain, /Доля просрочки/);
    assert.match(withDomain, /Прибыль/);
    assert.doesNotMatch(withDomain, /Cost of funds|Loan portfolio|Delinquency rate|\bProfit\b/);
  } finally { registry.RETAIL = original; }
});

test("an unmapped column in a recommendation falls back to the generic prettifier rather than a raw ID or a crash", () => {
  const unknownDataset: UploadedDataset = { name: "fixture.csv", columns: ["sensor_temp"], rows: Array.from({ length: 24 }, () => ({})) };
  const unknownAnalysis = { profile: { columns: [{ name: "sensor_temp", kind: "numeric", missing: 0, missingPercent: 20, unique: 24 }] } } as unknown as GenericAnalysis;
  const chain = { ...highRiskChain, edges: [{ ...highRiskChain.edges[0], from: "sensor_temp" }] } as unknown as PrecursorChain;
  const steps = buildNextSteps(unknownDataset, unknownAnalysis, chain);
  assert.match(steps.join(" "), /Sensor temp/);
});
