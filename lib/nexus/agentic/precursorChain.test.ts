import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrecursorChain } from "./precursorChain.ts";
import { pearsonCorrelation } from "../../engine/statistics.ts";
import { MIN_N_FOR_INFERENCE } from "../../engine/inferentialStats.ts";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";

/** Deterministic, non-monotonic pseudo-random-looking sequence — a real trend would stay correlated at
 * every lag and hide a wrong lag-alignment bug, so the fixture avoids one on purpose. */
const base = (i: number) => ((i * 37) % 23) - 11;

const NULL_INDICES = new Set([5, 15, 25, 35]);
const ROW_COUNT = 50;
const TRUE_LAG = 2;

function buildLaggedDataset(): UploadedDataset {
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
    leading: NULL_INDICES.has(i) ? null : base(i),
    target: base(i - TRUE_LAG),
  }));
  return { name: "lagged-fixture", columns: ["leading", "target"], rows };
}

function stubAnalysis(candidateColumn: string, targetColumn: string): GenericAnalysis {
  return {
    findings: [{ column: candidateColumn, latest: 0, mean: 0, standardDeviation: 1, zScore: 2, observationCount: ROW_COUNT, missingPercent: 0, direction: "rising" }],
    correlations: [],
    profile: { rowCount: ROW_COUNT, columnCount: 2, columns: [], dateColumns: [], numericColumns: [candidateColumn, targetColumn], categoricalColumns: [], duplicateRows: 0, invalidDateCount: 0, constantColumns: [] },
    limitations: [],
  };
}

/** Reference implementation of "pair from[i] with to[i+lag] by true row index, dropping only the pair
 * when either side is missing" — independent of precursorChain's own scanLags, so a bug that silently
 * compacts/misaligns nulls instead of indexing by true row position would show up as a mismatch. */
function referencePairs(from: Array<number | null>, to: Array<number | null>, lag: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + lag < to.length && i < from.length; i += 1) {
    const a = from[i], b = to[i + lag];
    if (a !== null && b !== null) pairs.push([a, b]);
  }
  return pairs;
}

test("buildPrecursorChain aligns pairs by true row index, not by position after independently dropping nulls", () => {
  const dataset = buildLaggedDataset();
  const leading = dataset.rows.map((row) => row.leading as number | null);
  const target = dataset.rows.map((row) => row.target as number | null);
  const chain = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target");
  const edge = chain.edges.find((candidate) => candidate.from === "leading");
  assert.ok(edge, "expected an edge from 'leading' to the 'target' anchor");

  for (const observation of edge!.allLags) {
    const expectedPairs = referencePairs(leading, target, observation.lag);
    assert.equal(observation.n, expectedPairs.length, `lag ${observation.lag}: n must equal the true row-index-aligned pair count`);
    const expectedCorrelation = pearsonCorrelation(expectedPairs.map((pair) => pair[0]), expectedPairs.map((pair) => pair[1]));
    assert.ok(Math.abs(observation.correlation - expectedCorrelation) < 1e-9, `lag ${observation.lag}: correlation must match independent row-aligned computation`);
  }
});

test("n is never inflated by treating a missing cell as 0 — nulls scattered mid-series are excluded, not zero-coerced", () => {
  const dataset = buildLaggedDataset();
  const chain = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target");
  const edge = chain.edges.find((candidate) => candidate.from === "leading")!;
  const atTrueLag = edge.allLags.find((observation) => observation.lag === TRUE_LAG)!;
  // i ranges 0..47 at lag 2 (48 candidate pairs); 4 of those rows have a null "leading" value.
  assert.equal(atTrueLag.n, 48 - NULL_INDICES.size);
});

test("buildPrecursorChain keeps every tested lag, not just the winner", () => {
  const dataset = buildLaggedDataset();
  const chain = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target");
  const edge = chain.edges.find((candidate) => candidate.from === "leading")!;
  assert.ok(edge.allLags.length > 1, "expected more than one tested lag to be retained");
  assert.deepEqual(edge.allLags.map((observation) => observation.lag), [...edge.allLags].sort((a, b) => a.lag - b.lag).map((observation) => observation.lag));
});

test("the strongest lag is the max |correlation| among all tested lags, and matches the true injected lag", () => {
  const dataset = buildLaggedDataset();
  const chain = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target");
  const edge = chain.edges.find((candidate) => candidate.from === "leading")!;
  const strongestByScan = edge.allLags.reduce((best, observation) => (Math.abs(observation.correlation) > Math.abs(best.correlation) ? observation : best));
  assert.equal(edge.lagPeriods, strongestByScan.lag);
  assert.ok(Math.abs(edge.correlation - strongestByScan.correlation) < 1e-9);
  assert.equal(edge.lagPeriods, TRUE_LAG, "the fixture injects a lag-2 relationship, so it must be the one surfaced");
});

test("bootstrap stability is calculated on the same source-row pairs as the selected lag", () => {
  const dataset = buildLaggedDataset();
  const edge = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target").edges[0];
  assert.equal(edge.lagPeriods, TRUE_LAG);
  assert.equal(edge.correlation, 1);
  assert.ok(edge.bootstrap, "enough aligned pairs exist for bootstrap");
  assert.ok(edge.bootstrap!.median > 0.99, "resampling perfectly aligned pairs must preserve their correlation");
  assert.equal(edge.bootstrap!.stability, "STABLE");
});

test("below the inference sample-size floor, ci95/pValue/bootstrap report INSUFFICIENT_SAMPLE (null) rather than a fabricated result", () => {
  assert.ok(MIN_N_FOR_INFERENCE > 5, "fixture assumes the inference floor is above the minimum paired-observation floor");
  const rows = Array.from({ length: 5 }, (_, i) => ({ small_leading: i + 1, small_target: (i + 1) * 2 }));
  const dataset: UploadedDataset = { name: "tiny-fixture", columns: ["small_leading", "small_target"], rows };
  const chain = buildPrecursorChain(dataset, stubAnalysis("small_leading", "small_target"), "small_target");
  const edge = chain.edges.find((candidate) => candidate.from === "small_leading")!;
  assert.equal(edge.n, 5);
  assert.equal(edge.ci95, null, "5 paired observations is below the inference floor — no confidence interval should be reported");
  assert.equal(edge.pValue, null);
  assert.equal(edge.significant, false);
  assert.equal(edge.bootstrap, null, "bootstrap should not run below its own minimum sample requirement");
});

test("causality is never asserted from a lag scan: the chain always reports NOT_ESTABLISHED", () => {
  const dataset = buildLaggedDataset();
  const chain = buildPrecursorChain(dataset, stubAnalysis("leading", "target"), "target");
  assert.equal(chain.causality, "NOT_ESTABLISHED");
});
