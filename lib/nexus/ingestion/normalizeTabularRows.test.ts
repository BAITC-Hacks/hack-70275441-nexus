import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTabularRows } from "./normalizeTabularRows.ts";
test("duplicate headers, including trimmed duplicates, reject before values are overwritten", () => {
  for (const headers of [["date", "workers", "workers"], ["date", " workers ", "workers"]]) assert.throws(() => normalizeTabularRows([headers, ["2026-01-01", 10, 100]]), /Duplicate column headers/);
});
test("unique headers retain original aligned values and actual zero", () => {
  assert.deepEqual(normalizeTabularRows([[" date ", "workers", "orders"], ["2026-01-01", 10, 0]]), [{ date: "2026-01-01", workers: 10, orders: 0 }]);
});
