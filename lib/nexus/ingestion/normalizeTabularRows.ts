import type { CellValue } from "./types.ts";

/** Converts parser cells into the JSON-safe values sent to API admission. */
export function normalizeTabularRows(rows: unknown[][]): Record<string, CellValue>[] {
  const [header, ...body] = rows;
  const columns = header.map((value, index) => String(value || `column_${index + 1}`).trim());
  if (new Set(columns).size !== columns.length) throw new Error("Duplicate column headers after normalization.");
  return body
    .filter((row) => row.some((value) => value !== "" && value !== null && value !== undefined))
    .map((row) => Object.fromEntries(columns.map((column, index) => {
      const value = row[index];
      if (value instanceof Date && Number.isFinite(value.getTime())) return [column, value.toISOString()];
      return [column, value === undefined || value === "" ? null : typeof value === "number" || typeof value === "boolean" ? value : String(value)];
    })));
}
