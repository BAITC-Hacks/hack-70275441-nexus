import test from "node:test";
import assert from "node:assert/strict";
import { inferPresentationCadence, formatLag, formatLagRange } from "./timeUnits.ts";
import { constructionTimeSeriesDataset } from "../demo/constructionTimeSeries.ts";

const dates = (values: unknown[]) => ({ name: "cadence", columns: ["date"], rows: values.map(date => ({ date })) }) as ReturnType<typeof constructionTimeSeriesDataset>;

test("exact weekly timestamps and both lag labels use weeks", () => {
  assert.equal(inferPresentationCadence(constructionTimeSeriesDataset(), "date"), "weekly");
  assert.equal(formatLag(1, "weekly"), "1 неделя");
  assert.equal(formatLag(2, "weekly"), "2 недели");
  assert.equal(formatLag(3, "weekly"), "3 недели");
  assert.equal(formatLag(11, "weekly"), "11 недель");
  assert.equal(formatLagRange({ min: 1, max: 3 }, "weekly"), "1–3 недели");
});

test("calendar-month timestamps use months including end-of-month observations", () => {
  for (const values of [["2025-01-01", "2025-02-01", "2025-03-01"], ["2025-01-31", "2025-02-28", "2025-03-31"]]) {
    assert.equal(inferPresentationCadence(dates(values), "date"), "monthly");
  }
  assert.equal(formatLag(2, "monthly"), "2 месяца");
});

test("missing, irregular, duplicate, invalid, unordered or ambiguous timestamps fall back to periods", () => {
  for (const values of [["2025-01-06", "2025-01-13"], ["2025-01-06", null, "2025-01-20"], ["2025-01-06", "2025-01-13", "2025-01-27"], ["2025-01-06", "2025-01-06", "2025-01-13"], ["2025-01-20", "2025-01-13", "2025-01-06"], ["2025-02-30", "2025-03-30", "2025-04-30"], ["2025-W01", "2025-W02", "2025-W03"]]) {
    assert.equal(inferPresentationCadence(dates(values), "date"), "unknown");
  }
  assert.equal(inferPresentationCadence(constructionTimeSeriesDataset(), null), "unknown");
  assert.equal(formatLag(2, "unknown"), "2 периода");
  assert.equal(formatLagRange({ min: 1, max: 3 }, "unknown"), "1–3 периода");
});
