import { clamp, pearsonCorrelation } from "../../engine/statistics.ts";
import { pearsonPValue, pearsonConfidenceInterval, holmSignificant, movingBlockBootstrap } from "../../engine/inferentialStats.ts";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import { isNumericCell } from "../ingestion/numericSeries.ts";
import type { LagObservation, PrecursorChain, PrecursorEdge } from "./types";

const MAX_LAG = 3;
const MAX_EDGES = 5;
const MIN_PAIRED_OBSERVATIONS = 5;
const SUFFICIENT_OBSERVATIONS = 30;
const BOOTSTRAP_ITERATIONS = 400;

/** A column as row-index-aligned values (null where the cell is missing/non-numeric) — never coerced to 0. */
function indexedColumn(dataset: UploadedDataset, column: string): Array<number | null> {
  return dataset.rows.map((row) => (isNumericCell(row[column]) ? Number(row[column]) : null));
}

/**
 * Tests every lag 0..MAX_LAG (not just the winner) by pairing row i of `from` with row i+lag of `to`
 * on the ORIGINAL row index — not on two independently-filtered arrays, which would silently misalign
 * once either column has a missing value anywhere but the very end. A pair only counts when both cells
 * are genuinely numeric at that row. The strongest lag is an exploratory pick from this multi-comparison
 * scan; every tested lag (with its own real pair count and p-value) is kept for Holm correction and
 * transparency, not discarded once the winner is chosen.
 */
function alignedPairs(from: Array<number | null>, to: Array<number | null>, lag: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + lag < to.length && i < from.length; i += 1) {
    const a = from[i], b = to[i + lag];
    if (a !== null && b !== null) pairs.push([a, b]);
  }
  return pairs;
}

function scanLags(from: Array<number | null>, to: Array<number | null>): LagObservation[] {
  const observations: LagObservation[] = [];
  const maxLag = Math.min(MAX_LAG, Math.floor(Math.min(from.length, to.length) / 4));
  for (let lag = 0; lag <= maxLag; lag += 1) {
    const pairs = alignedPairs(from, to, lag);
    if (pairs.length < MIN_PAIRED_OBSERVATIONS) break;
    const correlation = pearsonCorrelation(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]));
    observations.push({ lag, correlation, pValue: pearsonPValue(correlation, pairs.length), n: pairs.length });
  }
  return observations;
}

/**
 * Builds an ordered precursor chain from real lag-correlation statistics on the active dataset.
 * Every number here is computed from the uploaded rows — there is no domain-specific fitted coefficient.
 * See docs/methodology.md for what each field does and does not claim.
 */
export function buildPrecursorChain(dataset: UploadedDataset, analysis: GenericAnalysis, target?: string): PrecursorChain {
  const candidates = analysis.findings.map((finding) => finding.column).filter((column) => column !== target);
  const targetColumn = target && analysis.profile.numericColumns.includes(target) ? target : undefined;
  const anchor = targetColumn ?? candidates[0];
  const methodologyNotes = [
    "Each edge's strongest lag is an exploratory pick from testing lags 0-3 against the anchor; every tested lag is kept, and significance is Holm-corrected across that scan, not read off the single best lag in isolation.",
    "Lag correlation shows the signal moves before the anchor in this dataset — it is co-movement, not a verified causal delay.",
    targetColumn ? `Anchor: mapped target column "${targetColumn}".` : "No target column was mapped; the anchor is the most anomalous signal instead.",
    "n is the count of row-index-aligned pairs where both columns had a genuinely numeric value at that lag — missing/null/empty cells are excluded, never treated as 0.",
    "95% intervals use the Fisher z-transform; below 6 paired observations no interval is computed (reported as insufficient sample) rather than shown falsely precise.",
    "Bootstrap uses moving-block resampling (not row resampling, which would destroy the time-series/lag structure) to check how stable the correlation is under resampling — it estimates sampling stability, not the probability of a future event.",
  ];

  if (!anchor || candidates.length === 0) {
    return { edges: [], riskIndicator: 0, riskLabel: "LOW", causality: "NOT_ESTABLISHED", methodologyNotes: [...methodologyNotes, "Not enough numeric signals were available to compute a chain."] };
  }

  const anchorColumn = indexedColumn(dataset, anchor);
  const edges = candidates
    .filter((column) => column !== anchor)
    .map((column) => {
      const fromColumn = indexedColumn(dataset, column);
      const allLags = scanLags(fromColumn, anchorColumn);
      if (allLags.length === 0) return undefined;
      const strongest = allLags.reduce((best, obs) => (Math.abs(obs.correlation) > Math.abs(best.correlation) ? obs : best));
      const pValues = allLags.map((obs) => obs.pValue);
      const testable = pValues.every((p): p is number => p !== null);
      const significantFlags = testable ? holmSignificant(pValues) : allLags.map(() => false);
      const strongestIndex = allLags.indexOf(strongest);
      const strongestPairs = alignedPairs(fromColumn, anchorColumn, strongest.lag);
      const bootstrapRaw = strongestPairs.length >= 6 ? movingBlockBootstrap(strongestPairs.map((pair) => pair[0]), strongestPairs.map((pair) => pair[1]), `${column}->${anchor}:${strongest.n}`, BOOTSTRAP_ITERATIONS) : null;
      return {
        from: column,
        to: anchor,
        correlation: strongest.correlation,
        lagPeriods: strongest.lag,
        n: strongest.n,
        ci95: pearsonConfidenceInterval(strongest.correlation, strongest.n),
        pValue: strongest.pValue,
        significant: testable ? significantFlags[strongestIndex] : false,
        allLags,
        bootstrap: bootstrapRaw ? { median: bootstrapRaw.bootstrapMedian, ci95: bootstrapRaw.ci95, resamples: bootstrapRaw.successfulResamples, stability: bootstrapRaw.stabilityLabel } : null,
      } satisfies PrecursorEdge;
    })
    .filter((edge): edge is PrecursorEdge => edge !== undefined)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, MAX_EDGES)
    .sort((a, b) => b.lagPeriods - a.lagPeriods);

  const observationCount = edges.length ? Math.min(...edges.map((edge) => edge.n)) : 0;
  const dataSufficiencyFactor = clamp(observationCount / SUFFICIENT_OBSERVATIONS);
  if (edges.length && dataSufficiencyFactor < 1) methodologyNotes.push(`Observation count (${observationCount}) is below the ${SUFFICIENT_OBSERVATIONS}-row sufficiency threshold; the risk indicator is discounted by ${(dataSufficiencyFactor * 100).toFixed(0)}%.`);

  const significantCount = edges.filter((edge) => edge.significant).length;
  if (edges.length) methodologyNotes.push(`${significantCount} of ${edges.length} shown edges remain significant (p<0.05) after Holm correction for the lag scan; the rest are directional but not statistically distinguishable from noise at this sample size.`);

  const meanAbsoluteCorrelation = edges.length ? edges.reduce((sum, edge) => sum + Math.abs(edge.correlation), 0) / edges.length : 0;
  const riskIndicator = clamp(meanAbsoluteCorrelation * dataSufficiencyFactor);
  const riskLabel = riskIndicator < 0.33 ? "LOW" : riskIndicator < 0.66 ? "MEDIUM" : "HIGH";
  methodologyNotes.push(`Risk indicator = mean(|correlation at best lag|) across the top ${edges.length || 0} edges, scaled by the data-sufficiency factor. Thresholds: <0.33 LOW, <0.66 MEDIUM, else HIGH.`, "Correlation does not establish causality; this indicator ranks which signals moved together, not which caused the outcome.");

  return { edges, riskIndicator, riskLabel, causality: "NOT_ESTABLISHED", methodologyNotes };
}
