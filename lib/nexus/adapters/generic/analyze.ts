import { profileDataset } from "../../ingestion/profileDataset.ts";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import { numericSeries, numericPairs } from "../../ingestion/numericSeries.ts";
import { pearsonCorrelation as correlation } from "../../../engine/statistics.ts";

export interface GenericFinding { column: string; latest: number; mean: number; standardDeviation: number; zScore: number; observationCount: number; missingPercent: number; direction: "rising" | "falling"; }
export interface Correlation { left: string; right: string; value: number; }
export interface GenericAnalysis { findings: GenericFinding[]; correlations: Correlation[]; profile: ReturnType<typeof profileDataset>; limitations: string[]; }
export function analyzeGeneric(dataset: UploadedDataset, signals: string[]): GenericAnalysis {
  const profile = profileDataset(dataset); const numeric = signals.filter((column) => profile.numericColumns.includes(column));
  const findings = numeric.flatMap((column) => { const values = numericSeries(dataset.rows, column); if (values.length < 3) return []; const latest = values.at(-1)!; const mean = values.reduce((s, v) => s + v, 0) / values.length; const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length); const zScore = sd ? (latest - mean) / sd : 0; return Math.abs(zScore) >= 1 ? [{ column, latest, mean, standardDeviation: sd, zScore, observationCount: values.length, missingPercent: profile.columns.find((item) => item.name === column)?.missingPercent ?? 0, direction: latest >= values[Math.max(0, values.length - 2)] ? "rising" as const : "falling" as const }] : []; }).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  const correlations: Correlation[] = []; for (let i = 0; i < numeric.length; i += 1) for (let j = i + 1; j < numeric.length; j += 1) { const pairs = numericPairs(dataset.rows, numeric[i], numeric[j]); if (pairs.length >= 3) correlations.push({ left: numeric[i], right: numeric[j], value: correlation(pairs.map(([a]) => a), pairs.map(([, b]) => b)) }); }
  correlations.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const limitations = ["Generic Statistical Adapter: descriptive analysis only.", "Correlation does not establish causality.", ...(dataset.rows.length < 12 ? ["Limited observation count."] : [])];
  return { findings, correlations: correlations.slice(0, 5), profile, limitations };
}
