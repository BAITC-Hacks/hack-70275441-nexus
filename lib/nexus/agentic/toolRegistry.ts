import { profileDataset } from "../ingestion/profileDataset.ts";
import { numericSeries, numericPairs } from "../ingestion/numericSeries.ts";
import { pearsonCorrelation as correlation } from "../../engine/statistics.ts";
import { ruDecimal } from "../report/displayLabels.ts";
import type { ToolContext, ToolResult } from "./types";

const values = (context: ToolContext, column: string) => numericSeries(context.dataset.rows, column);
const mean = (items: number[]) => items.reduce((sum, item) => sum + item, 0) / items.length;
const deviation = (items: number[]) => { const average = mean(items); return Math.sqrt(items.reduce((sum, item) => sum + (item - average) ** 2, 0) / items.length); };

/**
 * Summaries are written directly in Russian rather than relying on `lib/nexus/report/displayLabels.ts`'s
 * regex-based English-to-Russian tail translation: that translation layer can only recognize a raw
 * canonical `[A-Za-z][A-Za-z0-9_]*` column ID as the sentence's leading identifier, so it silently leaves
 * the whole sentence untranslated whenever the actual dataset column name is itself Cyrillic (the normal
 * case for a Russian-language upload with no domain-schema rename applied) — see the investigation that
 * found `"Доля своевременных поставок: 0/5 recent adjacent movements were non-decreasing."` leaking into a
 * live PDF report. Writing the sentence in Russian at the source works regardless of the column's own name.
 */
export const analyticalTools = {
  profile_dataset: { description: "Profiles the active dataset deterministically.", execute(context: ToolContext): ToolResult { const profile = profileDataset(context.dataset); return { summary: `${profile.rowCount} наблюдений, ${profile.columnCount} колонок, ${profile.numericColumns.length} числовых колонок.`, variables: [], data: { rows: profile.rowCount, columns: profile.columnCount, numericColumns: profile.numericColumns, missing: profile.columns.reduce((sum, column) => sum + column.missing, 0) } }; } },
  inspect_series: { description: "Inspects basic deterministic descriptive statistics for a numeric series.", execute(context: ToolContext, args: Record<string, string>): ToolResult { const column = args.column; const series = values(context, column); const average = mean(series); const sd = deviation(series); const latest = series.at(-1) ?? 0; return { summary: `${column}: последнее значение ${ruDecimal(latest.toFixed(2))}, среднее ${ruDecimal(average.toFixed(2))}, стандартное отклонение ${ruDecimal(sd.toFixed(2))}.`, variables: [column], data: { latest, mean: average, standardDeviation: sd, observations: series.length } }; } },
  calculate_correlation: { description: "Calculates Pearson correlation for two numeric variables.", execute(context: ToolContext, args: Record<string, string>): ToolResult { const left = args.left, right = args.right; const pairs = numericPairs(context.dataset.rows, left, right); const value = pairs.length >= 3 ? correlation(pairs.map(([a]) => a), pairs.map(([, b]) => b)) : null; const summary = value === null ? `${left} ↔ ${right}: корреляция не рассчитана — только ${pairs.length} парных наблюдений (требуется минимум 3).` : `${left} ↔ ${right}: корреляция ${ruDecimal(value.toFixed(3))} по ${pairs.length} парным наблюдениям.`; return { summary, variables: [left, right], data: { correlation: value, observations: pairs.length } }; } },
  detect_outliers: { description: "Detects descriptive z-score outliers in one numeric series.", execute(context: ToolContext, args: Record<string, string>): ToolResult { const column = args.column; const series = values(context, column); const average = mean(series); const sd = deviation(series); const count = sd ? series.filter((item) => Math.abs((item - average) / sd) >= 1.5).length : 0; return { summary: `${column}: ${count} наблюдений соответствуют описательному правилу выбросов |z| ≥ 1,5.`, variables: [column], data: { outlierCount: count, threshold: 1.5, observations: series.length } }; } },
  inspect_missingness: { description: "Inspects missingness in one selected column.", execute(context: ToolContext, args: Record<string, string>): ToolResult { const column = args.column; const count = context.dataset.rows.filter((row) => row[column] === null || row[column] === "").length; return { summary: `${column}: пропущенных значений — ${count}.`, variables: [column], data: { missing: count, observations: context.dataset.rows.length } }; } },
  inspect_directional_movement: { description: "Inspects the recent direction of a numeric series.", execute(context: ToolContext, args: Record<string, string>): ToolResult { const column = args.column; const series = values(context, column); const recent = series.slice(-6); const rising = recent.slice(1).filter((item, index) => item >= recent[index]).length; return { summary: `${column}: ${rising} из ${Math.max(0, recent.length - 1)} последних смежных изменений были неснижающимися.`, variables: [column], data: { nonDecreasingMoves: rising, comparisons: Math.max(0, recent.length - 1), window: recent.length } }; } }
} as const;

export type AnalyticalToolName = keyof typeof analyticalTools;
