import { test } from "node:test";
import assert from "node:assert/strict";
import { pearsonPValue, pearsonConfidenceInterval, holmSignificant, movingBlockBootstrap, MIN_N_FOR_INFERENCE } from "./inferentialStats.ts";

test("pearsonConfidenceInterval returns null below the inference sample-size floor (INSUFFICIENT_SAMPLE)", () => {
  assert.equal(pearsonConfidenceInterval(0.7, MIN_N_FOR_INFERENCE - 1), null);
  assert.notEqual(pearsonConfidenceInterval(0.7, MIN_N_FOR_INFERENCE), null);
});

test("pearsonConfidenceInterval brackets r and widens as n shrinks", () => {
  const r = 0.6;
  const wide = pearsonConfidenceInterval(r, 8)!;
  const narrow = pearsonConfidenceInterval(r, 80)!;
  assert.ok(wide.lower < r && r < wide.upper, "the interval must contain the observed r");
  assert.ok(narrow.lower < r && r < narrow.upper);
  assert.ok(wide.upper - wide.lower > narrow.upper - narrow.lower, "a smaller sample must give a wider interval");
});

test("pearsonPValue: near-zero r on a large sample is not significant; large |r| is", () => {
  const pNull = pearsonPValue(0.02, 60)!;
  const pStrong = pearsonPValue(0.85, 60)!;
  assert.ok(pNull > 0.05, `expected a weak correlation to be non-significant, got p=${pNull}`);
  assert.ok(pStrong < 0.001, `expected a strong correlation to be highly significant, got p=${pStrong}`);
  assert.equal(pearsonPValue(0.5, MIN_N_FOR_INFERENCE - 1), null);
});

test("holmSignificant matches the textbook step-down example", () => {
  // p = [0.01, 0.02, 0.03, 0.04] at alpha=0.05: thresholds are 0.0125, 0.01667, 0.025, 0.05 in rank order.
  // Only the smallest p-value (0.01) clears its threshold before the procedure stops at the first failure.
  const result = holmSignificant([0.01, 0.02, 0.03, 0.04], 0.05);
  assert.deepEqual(result, [true, false, false, false]);
});

test("holmSignificant: all p-values well below alpha/m are all significant", () => {
  const result = holmSignificant([0.001, 0.002, 0.003, 0.004], 0.05);
  assert.deepEqual(result, [true, true, true, true]);
});

test("movingBlockBootstrap is deterministic for identical inputs and seed", () => {
  const a = Array.from({ length: 30 }, (_, i) => i + Math.sin(i));
  const b = Array.from({ length: 30 }, (_, i) => i * 0.9 + Math.cos(i));
  const first = movingBlockBootstrap(a, b, "same-seed", 200);
  const second = movingBlockBootstrap(a, b, "same-seed", 200);
  assert.deepEqual(first, second, "identical inputs and seed key must reproduce the identical bootstrap result");
});

test("movingBlockBootstrap does not crash on a constant series", () => {
  const a = Array.from({ length: 20 }, () => 5);
  const b = Array.from({ length: 20 }, (_, i) => i);
  const result = movingBlockBootstrap(a, b, "constant-series", 100);
  assert.equal(Number.isFinite(result.observedCorrelation), true);
  assert.equal(Number.isFinite(result.bootstrapMedian), true);
});

test("movingBlockBootstrap does not crash on a too-small series and marks it accordingly", () => {
  const a = [1, 2, 3];
  const b = [2, 4, 6];
  const result = movingBlockBootstrap(a, b, "tiny-series", 100);
  assert.equal(result.successfulResamples, 0);
  assert.equal(result.stabilityLabel, "UNSTABLE");
});
