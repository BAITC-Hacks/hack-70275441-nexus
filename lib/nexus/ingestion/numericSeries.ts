import type { CellValue } from "./types.ts";

/**
 * Strips thousands-separator whitespace ("1 500" -> "1500"). `\s` already covers the non-breaking,
 * thin and narrow no-break space variants Excel/1C-style exports commonly use for this. A genuinely
 * non-numeric string still fails to parse either way, so this never misclassifies real text as a number.
 */
const stripThousandsSeparators = (value: string): string => value.replace(/\s/g, "");

/**
 * Parses a cell to a finite number, or `null` if it is missing/non-numeric. Deliberately excludes
 * null/undefined/empty-string: `Number(null)` is `0` and `Number("")` is `0` in JS, so a naive
 * `Number(cell)` + `Number.isFinite` filter silently turns a missing observation into a real zero
 * instead of dropping it - corrupting both the paired-observation count (n) and any correlation
 * computed from it.
 */
export function numericValue(value: CellValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(stripThousandsSeparators(value.trim()));
  return Number.isFinite(parsed) ? parsed : null;
}

/** True for a value `numericValue` can parse. */
export const isNumericCell = (value: CellValue | undefined): boolean => numericValue(value) !== null;

/** Extracts one column as numbers, treating missing/null/empty cells as absent rather than coercing them to 0. */
export function numericSeries(rows: Record<string, CellValue>[], column: string): number[] {
  return rows.map((row) => numericValue(row[column])).filter((value): value is number => value !== null);
}

/** Extracts two columns as index-aligned numeric pairs, keeping a row only when BOTH cells are genuinely numeric. */
export function numericPairs(rows: Record<string, CellValue>[], columnA: string, columnB: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const row of rows) {
    const a = numericValue(row[columnA]), b = numericValue(row[columnB]);
    if (a !== null && b !== null) pairs.push([a, b]);
  }
  return pairs;
}
