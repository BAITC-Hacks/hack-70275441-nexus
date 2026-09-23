import type { CellValue, ColumnKind, ColumnProfile, DatasetProfile, UploadedDataset } from "./types";
import { numericValue } from "./numericSeries.ts";

const missing = (value: CellValue | undefined) => value === null || value === undefined || value === "";
const dateValue = (value: CellValue) => typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : Number.NaN;

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }
function profileColumn(name: string, rows: Record<string, CellValue>[]): ColumnProfile {
  const values = rows.map((row) => row[name]); const present = values.filter((value): value is CellValue => !missing(value));
  const numbers = present.map(numericValue).filter((value): value is number => value !== null); const dates = present.map(dateValue).filter(Number.isFinite);
  let kind: ColumnKind = "categorical";
  if (!present.length) kind = "empty";
  else if (present.every((value) => typeof value === "boolean" || value === "true" || value === "false")) kind = "boolean";
  else if (numbers.length === present.length) kind = "numeric";
  else if (dates.length === present.length && /date|time|timestamp|period/i.test(name)) kind = "datetime";
  const result: ColumnProfile = { name, kind, missing: values.length - present.length, missingPercent: values.length ? (values.length - present.length) / values.length * 100 : 0, unique: new Set(present.map(String)).size, first: present[0] ?? null, latest: present.at(-1) ?? null };
  if (kind === "numeric" && numbers.length) { const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length; result.min = Math.min(...numbers); result.max = Math.max(...numbers); result.mean = mean; result.median = median(numbers); result.standardDeviation = Math.sqrt(numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length); }
  return result;
}
export function profileDataset(dataset: UploadedDataset): DatasetProfile {
  const columns = dataset.columns.map((column) => profileColumn(column, dataset.rows));
  const dateColumns = columns.filter((column) => column.kind === "datetime").map((column) => column.name);
  const dateValues = dateColumns[0] ? dataset.rows.map((row) => new Date(String(row[dateColumns[0]])).getTime()).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const rows = dataset.rows.map((row) => JSON.stringify(row));
  return { rowCount: dataset.rows.length, columnCount: dataset.columns.length, columns, dateColumns, numericColumns: columns.filter((column) => column.kind === "numeric").map((column) => column.name), categoricalColumns: columns.filter((column) => column.kind === "categorical").map((column) => column.name), dateRange: dateValues.length ? { first: new Date(dateValues[0]).toISOString().slice(0, 10), last: new Date(dateValues.at(-1)!).toISOString().slice(0, 10) } : undefined, frequency: undefined, duplicateRows: rows.length - new Set(rows).size, invalidDateCount: 0, constantColumns: columns.filter((column) => column.unique <= 1).map((column) => column.name) };
}
