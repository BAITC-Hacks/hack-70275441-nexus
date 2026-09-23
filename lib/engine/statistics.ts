export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const standardDeviation = (values: number[]) => { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))); };
export const rollingStatistics = (values: number[], window: number) => values.map((_, index) => { const slice = values.slice(Math.max(0, index - window + 1), index + 1); return { mean: mean(slice), standardDeviation: standardDeviation(slice) }; });
export const percentageChange = (previous: number, current: number) => previous === 0 ? 0 : (current - previous) / Math.abs(previous);
export const zScore = (value: number, baseline: number[]) => { const deviation = standardDeviation(baseline); return deviation === 0 ? 0 : (value - mean(baseline)) / deviation; };
/** Maps a z-score to a capped 0..1 demo severity scale without allowing one spike to saturate confidence. */
export const anomalyScore = (value: number, baseline: number[]) => clamp(Math.abs(zScore(value, baseline)) / 20);
export const temporalConsistency = (values: number[], direction: "rising" | "falling") => { if (values.length < 2) return 0; const aligned = values.slice(1).filter((value, index) => direction === "rising" ? value >= values[index] : value <= values[index]); return aligned.length / (values.length - 1); };
/** Canonical Pearson correlation; the sole implementation used by both the generic analyzer and the agentic tool registry. */
export const pearsonCorrelation = (left: number[], right: number[]) => { const l = mean(left), r = mean(right); const numerator = left.reduce((sum, value, index) => sum + (value - l) * (right[index] - r), 0); const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - l) ** 2, 0) * right.reduce((sum, value) => sum + (value - r) ** 2, 0)); return denominator ? numerator / denominator : 0; };
