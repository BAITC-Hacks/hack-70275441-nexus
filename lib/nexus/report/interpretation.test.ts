import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { classifyCorrelationStrength, interpretMetricResult } from "./interpretation.ts";
import { displayLabel } from "./displayLabels.ts";
import { DOMAIN_PACKS } from "../domains/registry.ts";
import type { DomainPack } from "../domains/types.ts";

/**
 * No registered domain declares any overlapping `metrics` today — a synthetic RETAIL metric set stands
 * in for what a new domain's registered metrics (with `expectedLagPeriods`/`riskDirection`/aliases) would
 * look like once added.
 */
const registry = DOMAIN_PACKS as Record<string, DomainPack>;
let originalRetail: DomainPack;
before(() => {
  originalRetail = registry.RETAIL;
  registry.RETAIL = { ...originalRetail, metrics: {
    actual_delivery_qty: { canonicalName: "actual_delivery_qty", labelRu: "Факт поставки", role: "context", valueType: "continuous", riskDirection: "lower_is_worse", aliases: [], expectedLagPeriods: { min: 1, max: 3 } },
    schedule_gap_pp: { canonicalName: "schedule_gap_pp", labelRu: "Отставание от графика", role: "outcome", valueType: "percentage_points", riskDirection: "higher_is_worse", aliases: ["physical progress gap pp"] },
    usd_kzt: { canonicalName: "usd_kzt", labelRu: "Курс USD/KZT", role: "context", valueType: "continuous", riskDirection: "neutral", aliases: [] },
  } };
});
after(() => { registry.RETAIL = originalRetail; });

test("strength is descriptive, sign-independent and has exact threshold boundaries", () => {
  const cases = [[.1, "very_weak"], [.2, "weak"], [.3, "weak"], [.4, "moderate"], [.5, "moderate"], [.6, "strong"], [.7, "strong"], [.8, "very_strong"], [.9, "very_strong"]] as const;
  for (const [r, expected] of cases) {
    assert.equal(classifyCorrelationStrength(r), expected);
    assert.equal(classifyCorrelationStrength(-r), expected);
  }
  for (const r of [NaN, Infinity, -Infinity, 1.1]) assert.equal(classifyCorrelationStrength(r), undefined);
});

test("temporal status compares measured lags to metadata without asserting observations from priors", () => {
  const base = { domainId: "retail", metric: "actual_delivery_qty", correlation: -.9 };
  assert.equal(interpretMetricResult({ ...base, lagPeriods: 2 }).temporal.status, "consistent_with_domain_prior");
  assert.equal(interpretMetricResult({ ...base, lagPeriods: 5 }).temporal.status, "outside_expected_range");
  assert.equal(interpretMetricResult({ ...base, lagPeriods: 0 }).temporal.status, "not_temporally_leading");
  assert.equal(interpretMetricResult({ ...base, lagPeriods: -2 }).temporal.status, "not_temporally_leading");
  assert.equal(interpretMetricResult(base).temporal.status, "no_domain_prior");
  assert.equal(interpretMetricResult({ ...base, metric: "usd_kzt", lagPeriods: 2 }).temporal.status, "no_domain_prior");
  const metadataOnly = interpretMetricResult({ domainId: "retail", metric: base.metric });
  assert.equal(metadataOnly.technical.correlation, undefined);
  assert.equal(metadataOnly.temporal.measuredLagPeriods, undefined);
  assert.equal(metadataOnly.significance.status, "unknown");
});

test("significance preserves pipeline correction independently of strength and raw p-value", () => {
  const base = { metric: "unknown", correlation: .9, pValue: .03 };
  assert.equal(interpretMetricResult(base).significance.status, "statistically_significant");
  const corrected = interpretMetricResult({ ...base, significant: false });
  assert.equal(corrected.strength, "very_strong");
  assert.equal(corrected.significance.status, "not_statistically_significant");
  assert.equal(corrected.significance.basis, "pipeline_decision");
  assert.equal(corrected.technical.pValue, .03);
  assert.equal(interpretMetricResult({ ...base, pValue: .05 }).significance.status, "not_statistically_significant");
  assert.equal(interpretMetricResult({ ...base, pValue: null, significant: false }).significance.status, "unknown");
});

test("risk movement requires actual movement information, never correlation sign", () => {
  const base = { domainId: "retail", metric: "actual_delivery_qty", correlation: -.9, lagPeriods: 2 };
  assert.equal(interpretMetricResult(base).directionAssessment.status, "not_applicable");
  assert.equal(interpretMetricResult({ ...base, movement: "falling" }).directionAssessment.status, "consistent");
  assert.equal(interpretMetricResult({ ...base, movement: "rising" }).directionAssessment.status, "inconsistent");
  assert.equal(interpretMetricResult({ ...base, movement: "stable" }).directionAssessment.status, "neutral");
  assert.equal(interpretMetricResult({ ...base, metric: "usd_kzt", movement: "rising" }).directionAssessment.status, "neutral");
});

test("unknown domains and metrics retain technical interpretation and shared display fallbacks", () => {
  for (const domainId of [undefined, "unknown-domain", "government_services"]) {
    const output = interpretMetricResult({ domainId, metric: "unknown_metric", correlation: .72, lagPeriods: 2 });
    assert.equal(output.canonicalMetric, "unknown_metric");
    assert.equal(output.displayName, displayLabel("unknown_metric"));
    assert.equal(output.strength, "strong");
    assert.equal(output.temporal.status, "no_domain_prior");
    assert.equal(output.role, undefined);
    assert.equal(output.riskDirection, undefined);
  }
  assert.equal(interpretMetricResult({ domainId: "retail", metric: "Schedule Delay" }).canonicalMetric, "Schedule Delay");
  assert.equal(interpretMetricResult({ domainId: "retail", metric: "Schedule Delay" }).unit, undefined);
  assert.equal(interpretMetricResult({ domainId: "retail", metric: "physical progress gap pp" }).canonicalMetric, "schedule_gap_pp");
});

test("CI and bootstrap are preserved as detached presentation values; invalid numerics are not fabricated", () => {
  const input = { metric: "x", correlation: -.9, confidenceInterval: [-.98, -.7] as const, bootstrap: { median: -.9, ci95: { lower: -.98, upper: -.7 }, resamples: 400, stability: "STABLE" as const } };
  const original = structuredClone(input);
  const output = interpretMetricResult(input);
  assert.deepEqual(output.technical.confidenceInterval, [-.98, -.7]);
  assert.deepEqual(output.technical.bootstrap, input.bootstrap);
  output.technical.bootstrap!.ci95.lower = -.5;
  assert.deepEqual(input, original);
  const invalid = interpretMetricResult({ metric: "x", correlation: Infinity, pValue: NaN, lagPeriods: NaN, confidenceInterval: [.9, -.9] });
  assert.equal(invalid.strength, undefined);
  assert.equal(invalid.technical.confidenceInterval, undefined);
  assert.equal(invalid.significance.status, "unknown");
});
