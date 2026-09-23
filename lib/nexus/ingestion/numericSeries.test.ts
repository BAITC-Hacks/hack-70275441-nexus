import { test } from "node:test";
import assert from "node:assert/strict";
import { isNumericCell, numericSeries, numericPairs, numericValue } from "./numericSeries.ts";
import type { CellValue } from "./types.ts";

test("isNumericCell rejects null/undefined/empty-string (the Number(null)===0 trap)", () => {
  assert.equal(isNumericCell(null), false);
  assert.equal(isNumericCell(undefined), false);
  assert.equal(isNumericCell(""), false);
  assert.equal(isNumericCell("   "), false);
  assert.equal(isNumericCell(0), true);
  assert.equal(isNumericCell("0"), true);
  assert.equal(isNumericCell(5), true);
  assert.equal(isNumericCell("5.5"), true);
  assert.equal(isNumericCell("not-a-number"), false);
});

test("isNumericCell and numericValue strip thousands-separator whitespace (plain and non-breaking space) but never misread real text as a number", () => {
  assert.equal(isNumericCell("1 500"), true);
  assert.equal(numericValue("1 500"), 1500);
  assert.equal(isNumericCell("12 345 678"), true);
  assert.equal(numericValue("12 345 678"), 12345678);
  // Built from a char code, not typed literally, so the exact separator (U+00A0, Excel/1C ru-RU
  // thousands separator) is unambiguous regardless of editor/encoding.
  const nonBreakingSeparated = "1" + String.fromCharCode(160) + "500";
  assert.equal(isNumericCell(nonBreakingSeparated), true, "non-breaking space (U+00A0) thousands separator");
  assert.equal(numericValue(nonBreakingSeparated), 1500);
  assert.equal(isNumericCell("12 345 rows"), false, "text containing digits and spaces must not become numeric");
  assert.equal(numericValue("abc def"), null);
});

test("numericSeries drops missing cells instead of coercing them to 0", () => {
  const rows: Record<string, CellValue>[] = [{ x: 1 }, { x: null }, { x: 2 }, { x: "" }, { x: 3 }, {}];
  const series = numericSeries(rows, "x");
  assert.deepEqual(series, [1, 2, 3]);
  assert.equal(series.length, 3, "3 missing cells must not become three zeros");
});

test("numericPairs only keeps rows where BOTH columns are genuinely numeric", () => {
  const rows = [
    { a: 1, b: 10 },
    { a: null, b: 20 }, // a missing -> row dropped
    { a: 3, b: null }, // b missing -> row dropped
    { a: 4, b: 40 },
  ];
  const pairs = numericPairs(rows, "a", "b");
  assert.deepEqual(pairs, [[1, 10], [4, 40]]);
});
