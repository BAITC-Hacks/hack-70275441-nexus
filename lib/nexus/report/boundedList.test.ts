import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBoundedIds } from "./boundedList.ts";

test("large source-row lists show a count, bounded preview and remaining count", () => {
  const ids = Array.from({ length: 15000 }, (_, i) => i + 1);
  const output = formatBoundedIds(ids);
  assert.ok(output.startsWith("15000 ID · 1, 2, 3"));
  assert.ok(output.endsWith("(ещё 14988)"));
  assert.ok(!output.includes(", 13")); assert.ok(output.length < 150);
  assert.equal(ids.length, 15000);
});
test("empty and small lists retain exact bounded values", () => {
  assert.equal(formatBoundedIds([]), "0 ID");
  assert.equal(formatBoundedIds(["EV-A", "EV-B"]), "2 ID · EV-A, EV-B");
});
