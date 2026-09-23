import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticalTools } from "./toolRegistry.ts";
import { relabelEvidenceSummary } from "../report/displayLabels.ts";
import type { ToolContext } from "./types.ts";

const rows = (values: Array<[number | null, number | null]>) =>
  values.map(([left, right]) => ({ left, right }));

test("calculate_correlation reports insufficient data instead of a fabricated zero when fewer than 3 pairs exist", () => {
  const context: ToolContext = { dataset: { name: "t", columns: ["left", "right"], rows: rows([[1, 2], [2, 4]]) }, signals: [] };
  const result = analyticalTools.calculate_correlation.execute(context, { left: "left", right: "right" });
  assert.equal(result.data.correlation, null, "correlation must be null, not a fabricated 0, below the minimum pair count");
  assert.equal(result.data.observations, 2);
  assert.match(result.summary, /корреляция не рассчитана — только 2 парных наблюдений \(требуется минимум 3\)\./);
});

test("calculate_correlation still computes a real value once at least 3 pairs exist", () => {
  const context: ToolContext = { dataset: { name: "t", columns: ["left", "right"], rows: rows([[1, 2], [2, 4], [3, 6]]) }, signals: [] };
  const result = analyticalTools.calculate_correlation.execute(context, { left: "left", right: "right" });
  assert.equal(result.data.observations, 3);
  assert.equal(typeof result.data.correlation, "number");
  assert.match(result.summary, /^left ↔ right: корреляция 1,000 по 3 парным наблюдениям\.$/);
});

test("the insufficient-data sentence is translated to Russian, not left as an English leak", () => {
  const translated = relabelEvidenceSummary("left ↔ right: correlation not computed — only 2 paired observations (minimum 3 required).");
  assert.doesNotMatch(translated, /correlation|paired observations/i);
  assert.match(translated, /корреляция не рассчитана — только 2 парных наблюдений \(требуется минимум 3\)\./);
});
