import assert from "node:assert/strict";
import test from "node:test";
import { DOMAIN_PACKS, getDomainConcept, getDomainPack } from "./registry.ts";

// Test-only collision checking; this is not a production alias resolver.
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[\s\p{P}\p{S}]+/gu, "");
const packs = Object.values(DOMAIN_PACKS);
const ambiguous = ["id", "score", "срок", "сумма", "дата", "тип", "статус", "значение", "amount", "date", "type", "status", "value", "cost", "margin"];

test("registry contains the registered metric domains", () => {
  assert.deepEqual(Object.keys(DOMAIN_PACKS).sort(), ["LOGISTICS", "MANUFACTURING", "MINING", "RETAIL"]);
  for (const pack of packs) assert.equal(getDomainPack(pack.id), pack);
});

test("canonical IDs are unique within each pack", () => {
  for (const pack of packs) assert.equal(new Set(pack.concepts.map(c => c.canonicalId)).size, pack.concepts.length);
});

test("canonical IDs use snake_case", () => {
  for (const pack of packs) for (const concept of pack.concepts) assert.match(concept.canonicalId, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
});

test("normalized aliases do not collide across concepts", () => {
  for (const pack of packs) {
    const owners = new Map<string, string>();
    for (const concept of pack.concepts) for (const alias of concept.aliases) {
      const key = normalize(alias);
      assert.ok(!owners.has(key) || owners.get(key) === concept.canonicalId, `${pack.id}: ${alias} conflicts between ${owners.get(key)} and ${concept.canonicalId}`);
      owners.set(key, concept.canonicalId);
    }
  }
});

test("aliases do not conflict with another canonical ID", () => {
  for (const pack of packs) {
    const ids = new Map(pack.concepts.map(c => [normalize(c.canonicalId), c.canonicalId]));
    for (const concept of pack.concepts) for (const alias of concept.aliases) {
      const owner = ids.get(normalize(alias));
      assert.ok(owner === undefined || owner === concept.canonicalId, `${pack.id}: ${alias} conflicts with ${owner}`);
    }
  }
});

test("numeric concepts declare unit families", () => {
  for (const pack of packs) for (const concept of pack.concepts) if (concept.dataType === "NUMERIC") assert.ok(concept.unitFamily, concept.canonicalId);
});

test("direction belongs only to metrics", () => {
  for (const pack of packs) for (const concept of pack.concepts) if (concept.direction !== undefined) assert.equal(concept.kind, "METRIC", concept.canonicalId);
});

test("valid dimensions refer to declared dimension concepts", () => {
  for (const pack of packs) for (const concept of pack.concepts) for (const dimension of concept.validDimensions ?? []) assert.equal(getDomainConcept(pack.id, dimension)?.kind, "DIMENSION", dimension);
});

test("causal prior endpoints exist in their own domain", () => {
  for (const pack of packs) for (const prior of pack.priors) {
    assert.ok(getDomainConcept(pack.id, prior.from), prior.from);
    assert.ok(getDomainConcept(pack.id, prior.to), prior.to);
  }
});

test("every causal prior disclaims dataset causality", () => {
  for (const pack of packs) {
    assert.ok(pack.priors.length <= 4 && (pack.concepts.length === 0 || pack.priors.length > 0));
    for (const prior of pack.priors) assert.match(prior.note, /not evidence of causality in the current dataset/i);
    assert.ok(pack.forbiddenOverclaims.length > 0);
    for (const wording of pack.forbiddenOverclaims) assert.ok(wording.trim());
  }
});

test("aliases are nonempty after normalization", () => {
  for (const pack of packs) for (const concept of pack.concepts) {
    assert.ok(concept.aliases.length > 0);
    for (const alias of concept.aliases) assert.ok(normalize(alias), concept.canonicalId);
  }
});

test("dangerous short aliases require exactOnly", () => {
  for (const pack of packs) for (const concept of pack.concepts) for (const alias of concept.aliases) if (ambiguous.map(normalize).includes(normalize(alias))) assert.equal(concept.exactOnly, true, `${pack.id}: ${alias}`);
});

test("context-sensitive bare aliases document their ambiguity", () => {
  for (const pack of packs) for (const concept of pack.concepts) for (const alias of concept.aliases) if (ambiguous.map(normalize).includes(normalize(alias))) assert.ok(concept.semanticNotes?.some(note => note.trim()), `${pack.id}: ${alias}`);
  for (const alias of ["ID", "Score", "Срок", "Сумма", "Дата", "Тип", "Значение"]) for (const pack of packs) assert.ok(!pack.concepts.some(c => c.aliases.some(a => normalize(a) === normalize(alias))), alias);
});

test("domain data survives a pure JSON roundtrip", () => {
  for (const pack of packs) assert.deepEqual(JSON.parse(JSON.stringify(pack)), pack);
});

test("domain data contains only plain JSON values without executables", () => {
  function inspect(value: unknown): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") { assert.ok(Number.isFinite(value)); return; }
    assert.equal(typeof value, "object");
    assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
    for (const child of Object.values(value as Record<string, unknown>)) inspect(child);
  }
  for (const pack of packs) inspect(pack);
});

test("pack and concept labels are nonempty in Russian and English", () => {
  for (const pack of packs) for (const item of [pack, ...pack.concepts]) {
    assert.ok(item.labelRu.trim()); assert.ok(item.labelEn.trim());
  }
});

test("concept lookup is exact canonical lookup only", () => {
  // No registered domain declares any `concepts` today (see resolution.test.ts's note) — this only
  // checks the lookup fails closed rather than throwing, not a specific concept's round-trip.
  assert.equal(getDomainConcept("MINING", "missing_concept"), undefined);
});
