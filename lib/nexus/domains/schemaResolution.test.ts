import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatasetSchema } from "./schemaResolution.ts";
import { normalizeMetricAlias, buildMetricAliasIndex } from "./metricAliases.ts";
import { getDomainPack, listDomainPacks, resolveMetricAlias } from "./registry.ts";
import { schemaFixtures } from "./schemaFixtures.ts";

test("strict normalization supports case, punctuation, whitespace, ё and camel-style registered equivalents", () => {
  for (const alias of [" Расход ГСМ ", "РАСХОД ГСМ", "расход_гсм", "расход-гсм", "расход/гсм", "«Расход  ГСМ»", "расход гсм"]) assert.equal(resolveMetricAlias("mining", alias), "fuel_consumption");
  assert.equal(normalizeMetricAlias("Расход\tГСМ"), normalizeMetricAlias("расход гсм"));
  assert.equal(resolveMetricAlias("mining", "crusherDowntimeHours"), "crusher_downtime");
  for (const alias of ["расход гсм средний", "fuelconsumption", "amount", "срок", "cost", "__proto__"]) assert.equal(resolveMetricAlias("mining", alias), undefined);
  assert.notEqual(normalizeMetricAlias("Возвраты %"), normalizeMetricAlias("Возвраты"));
  for (const bare of ["ДСК", "БВР", "ГСМ", "Содержание", "Руда", "Штабель", "Рейс"]) assert.equal(resolveMetricAlias("mining", bare), undefined);
});
test("all registered metric packs validate; duplicate raw/normalized aliases fail; cross-domain aliases are allowed", () => {
  listDomainPacks().forEach(p => assert.doesNotThrow(() => buildMetricAliasIndex(p)));
  const original = getDomainPack("MINING");
  const a = { canonicalName: "a", role: "context" as const, valueType: "continuous" as const, riskDirection: "neutral" as const, aliases: ["shared alias"] };
  const b = { ...a, canonicalName: "b", aliases: ["SHARED_ALIAS"] };
  assert.throws(() => buildMetricAliasIndex({ ...original, metrics: { a, b } }), /Duplicate normalized/);
  assert.throws(() => buildMetricAliasIndex({ ...original, metrics: { a: { ...a, aliases: ["shared alias", "shared alias"] } } }), /Duplicate normalized/);
  assert.throws(() => buildMetricAliasIndex({ ...original, metrics: { a: { ...a, aliases: ["shared alias", "SHARED_ALIAS"] } } }), /Duplicate normalized/);
  assert.equal(resolveMetricAlias("retail", "Выручка"), "revenue");
  assert.equal(resolveMetricAlias("logistics", "Логистические затраты"), "logistics_cost");
  assert.equal(resolveDatasetSchema(["Логистические затраты"]).domain.status, "UNKNOWN", "one shared column alone never reaches either domain's minimumMatch");
});
test("four domain fixtures resolve and ties/unknown are never chosen by registry order", () => {
  for (const [fixture, id] of [["retail", "RETAIL"], ["logistics", "LOGISTICS"], ["manufacturing", "MANUFACTURING"], ["mining", "MINING"]] as const) {
    const result = resolveDatasetSchema(schemaFixtures[fixture]);
    assert.equal(result.domain.status, "RESOLVED", fixture);
    assert.equal(result.domain.selectedDomainId, id, fixture);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
  const ambiguous = resolveDatasetSchema(schemaFixtures.ambiguous);
  assert.equal(ambiguous.domain.status, "AMBIGUOUS");
  assert.equal(ambiguous.domain.selectedDomainId, undefined);
  assert.deepEqual(ambiguous, resolveDatasetSchema(schemaFixtures.ambiguous, { packs: [...listDomainPacks()].reverse() }));
  assert.equal(resolveDatasetSchema(schemaFixtures.unknown).domain.status, "UNKNOWN");
});
test("Mining and Retail aliases are semantic and qualified where required", () => {
  for (const [column, canonical] of [["Добыча руды", "ore_production"], ["Простой дробилки", "crusher_downtime"], ["Коэффициент извлечения", "recovery_rate"], ["Содержание руды", "ore_grade"], ["Расход ГСМ", "fuel_consumption"]]) assert.equal(resolveMetricAlias("mining", column), canonical);
  for (const bare of ["ДСК", "БВР", "ГСМ", "Содержание", "Руда", "Штабель", "Рейс"]) assert.equal(resolveMetricAlias("mining", bare), undefined);
  for (const [column, canonical] of [["Выручка", "revenue"], ["Оборот", "revenue"], ["Остатки", "inventory"], ["Средний чек", "average_order_value"], ["Возвраты, %", "returns_rate"], ["Оборот запасов", "inventory_turnover"]]) assert.equal(resolveMetricAlias("retail", column), canonical);
  assert.equal(resolveMetricAlias("retail", "Возвраты"), undefined);
});
test("manual overrides warn without guessed fields; duplicate source mappings remain ambiguous", () => {
  const conflict = resolveDatasetSchema(schemaFixtures.mining, { domainId: "retail" });
  assert.equal(conflict.domain.selectedDomainId, "RETAIL");
  assert.ok(conflict.warnings.length);
  assert.ok(conflict.columns.every(c => c.status === "UNKNOWN"));
  assert.equal(resolveDatasetSchema(schemaFixtures.mining, { domainId: "__proto__" }).domain.status, "UNKNOWN");
  const duplicates = resolveDatasetSchema(["Добыча руды", "Добыча"], { domainId: "mining" });
  assert.ok(duplicates.columns.every(c => c.status === "AMBIGUOUS" && c.canonicalMetric === null));
});
test("declared detection exclusions/minimums and exact score are enforced", () => {
  const pack = getDomainPack("MINING");
  const result = resolveDatasetSchema(schemaFixtures.mining);
  assert.equal(result.domain.candidates[0].score, 31); // 5*2 + 4*5 + one outcome.
  assert.equal(resolveDatasetSchema(schemaFixtures.mining, { packs: [{ ...pack, detection: { ...pack.detection!, excludedMetrics: ["ore_grade"] } }] }).domain.status, "UNKNOWN");
  assert.equal(resolveDatasetSchema(["ore_production", "ore_grade"]).domain.status, "UNKNOWN");
});
test("metric priors and detection references stay valid declarations", () => {
  for (const pack of listDomainPacks()) {
    for (const prior of pack.causalPriors ?? []) { assert.ok(pack.metrics?.[prior.from]); assert.ok(pack.metrics?.[prior.to]); assert.match(prior.note, /hypothesis|not evidence|not Evidence/i); }
    for (const metric of [...(pack.detection?.strongMetrics ?? []), ...(pack.detection?.characteristicMetrics ?? []), ...(pack.outcomeMetrics ?? [])]) assert.ok(pack.metrics?.[metric]);
  }
  assert.equal(getDomainPack("MINING").metrics?.fuel_consumption.unit, "liters");
  assert.equal(getDomainPack("MINING").metrics?.fuel_consumption.role, "context");
});
