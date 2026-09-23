import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCrossSectionalBusinessSummary } from "./crossSectionalBusinessSummary.ts";
import { buildEventTransactionBusinessSummary } from "./eventTransactionBusinessSummary.ts";
import { analyzeCrossSectional } from "../crossSectional/tools.ts";
import { analyzeEventTransactions } from "../eventTransaction/tools.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

const dataset: UploadedDataset = { name: "appeals.csv", columns: ["request_id", "submitted_at", "service_type", "department", "processing_days", "Тип обращения"], rows: Array.from({ length: 30 }, (_, i) => ({ request_id: `R${i}`, submitted_at: new Date(Date.UTC(2026, 7, 1) + i * 60000).toISOString(), service_type: i < 10 ? "Земельные вопросы" : "Справки", department: "Управление", processing_days: i < 10 ? 20 : 2, "Тип обращения": "Жалоба" })) };

test("ordinary event summaries do not invent problems", () => {
  const ordinary = analyzeEventTransactions({ ...dataset, columns: dataset.columns.filter(c => c !== "processing_days") });
  const summary = buildEventTransactionBusinessSummary(ordinary);
  assert.ok(summary.headline.includes(String(ordinary.detection.notableEvents.length)));
  assert.ok(summary.uncertainty.join(" ").includes("Причинная связь не доказана"));
});

test("cross-sectional summary preserves sample size and handles an absent target", () => {
  const input: UploadedDataset = { name: "entities.csv", columns: ["client_id", "risk_score", "amount"], rows: Array.from({ length: 30 }, (_, i) => ({ client_id: `C${i}`, risk_score: i, amount: i * 2 })) };
  const analysis = analyzeCrossSectional(input, "risk_score"), original = structuredClone(analysis);
  const summary = buildCrossSectionalBusinessSummary(analysis);
  assert.ok(summary.headline.includes(`${analysis.drivers[0].n} наблюдениям`));
  assert.ok(summary.whyItMatters.includes(String(analysis.highRisk.entities.length)));
  assert.ok(summary.uncertainty[0].includes("не доказывает причинную"));
  const missing = buildCrossSectionalBusinessSummary({ ...analysis, target: { ...analysis.target, column: null }, drivers: [], associations: [], highRisk: { ...analysis.highRisk, entities: [] } });
  assert.ok(missing.findings.some(text => text.includes("показатель отсутствует")));
  assert.deepEqual(analysis, original);
});

test("formatter modules contain no network/model calls or raw technical scoring names", () => {
  for (const file of ["crossSectionalBusinessSummary.ts", "eventTransactionBusinessSummary.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/\bfetch\s*\(|\bOpenAI\b|responses\.create/.test(source));
  }
  const summary = JSON.stringify(buildEventTransactionBusinessSummary(analyzeEventTransactions(dataset)));
  assert.ok(!/normalized_delay_severity|support_factor|targetAssociation|E-\d+/.test(summary));
});
