import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { resolveColumn, resolveDatasetColumns } from "./resolution.ts";
import { validateProposedMapping } from "./structuralValidator.ts";
import { DOMAIN_PACKS, getDomainConcept } from "./registry.ts";
import type { CanonicalConcept, DomainId, DomainPack } from "./types.ts";
import type { CellValue } from "../ingestion/types.ts";
import { profileDataset } from "../ingestion/profileDataset.ts";
import { normalizeHeader, normalizeHeaderName } from "../universal/headers.ts";

/**
 * No registered domain (RETAIL/LOGISTICS/MANUFACTURING/MINING) declares any `concepts` today — they only
 * populate the lighter `metrics` vocabulary. The rich per-column resolver (`resolveColumn`,
 * `validateProposedMapping`) is still real, generic harness machinery, just currently unpopulated. These
 * tests exercise it with a synthetic vocabulary injected into three still-registered domains, standing in
 * for what a new domain's `concepts` array would look like once one is added.
 */
const DOMAIN_A: DomainId = "RETAIL";
const DOMAIN_B: DomainId = "LOGISTICS";
const DOMAIN_C: DomainId = "MANUFACTURING";

const metric = (over: Partial<CanonicalConcept> & Pick<CanonicalConcept, "canonicalId" | "dataType">): CanonicalConcept => ({
  kind: "METRIC", labelRu: over.canonicalId, labelEn: over.canonicalId, aliases: [], ...over,
});

const CONCEPTS_A: CanonicalConcept[] = [
  metric({ canonicalId: "delinquency_days", dataType: "NUMERIC", unitFamily: "DAYS", aliases: ["days past due"] }),
  metric({ canonicalId: "delinquency_count", dataType: "NUMERIC", unitFamily: "COUNT" }),
  metric({ canonicalId: "client_id", dataType: "IDENTIFIER" }),
  metric({ canonicalId: "net_cash_flow", dataType: "NUMERIC", unitFamily: "CURRENCY" }),
  metric({ canonicalId: "transaction_count", dataType: "NUMERIC", unitFamily: "COUNT" }),
  metric({ canonicalId: "dti", dataType: "NUMERIC", unitFamily: "RATIO" }),
  metric({ canonicalId: "risk_score", dataType: "NUMERIC", unitFamily: "SCORE" }),
  { ...metric({ canonicalId: "region", dataType: "CATEGORICAL" }), kind: "DIMENSION" },
  metric({ canonicalId: "submitted_at", dataType: "DATETIME" }),
];
const CONCEPTS_B: CanonicalConcept[] = [
  metric({ canonicalId: "actual_progress", dataType: "NUMERIC", unitFamily: "PERCENTAGE" }),
  metric({ canonicalId: "planned_progress", dataType: "NUMERIC", unitFamily: "PERCENTAGE" }),
];
const CONCEPTS_C: CanonicalConcept[] = [
  metric({ canonicalId: "processing_time", dataType: "NUMERIC", unitFamily: "DAYS", aliases: ["Фактический срок ответа (дней)"] }),
  { ...metric({ canonicalId: "request_status", dataType: "CATEGORICAL", aliases: ["Статус обращения"] }), kind: "DIMENSION", exactOnly: true },
  metric({ canonicalId: "satisfaction", dataType: "NUMERIC", unitFamily: "SCORE", aliases: ["Оценка удовлетворённости"] }),
  metric({ canonicalId: "repeat_request", dataType: "BOOLEAN", valueAliases: { true: ["повторное"], false: ["первичное"] } }),
  metric({ canonicalId: "completed_at", dataType: "DATETIME", aliases: ["дата ответа/закрытия"] }),
];

const originals = new Map<DomainId, DomainPack>();
before(() => {
  const registry = DOMAIN_PACKS as Record<DomainId, DomainPack>;
  for (const [id, concepts] of [[DOMAIN_A, CONCEPTS_A], [DOMAIN_B, CONCEPTS_B], [DOMAIN_C, CONCEPTS_C]] as const) {
    originals.set(id, registry[id]);
    registry[id] = { ...registry[id], concepts };
  }
});
after(() => {
  const registry = DOMAIN_PACKS as Record<DomainId, DomainPack>;
  for (const [id, pack] of originals) registry[id] = pack;
});

const concept = (id: string, domain: DomainId = DOMAIN_A) => getDomainConcept(domain, id)!;
function validate(c: CanonicalConcept, values: CellValue[], name = "unknown") {
  const profile = profileDataset({ name: "test", columns: [name], rows: values.map(value => ({ [name]: value })) }).columns[0];
  return validateProposedMapping(c, profile, values, values.length);
}
// Isolated synthetic vocabulary tests exercise conflicts absent from the base fixture above.
// Restore the registry entry synchronously; no pack or existing concept is mutated beyond this test.
function withConcepts(concepts: CanonicalConcept[], run: () => void) {
  const registry = DOMAIN_PACKS as Record<DomainId, DomainPack>;
  const original = registry[DOMAIN_A];
  try { registry[DOMAIN_A] = { ...original, concepts }; run(); } finally { registry[DOMAIN_A] = original; }
}

test("exact canonical ID has first priority", () => {
  assert.equal(resolveColumn("delinquency_days", DOMAIN_A).method, "EXACT_CANONICAL");
});
test("exact Russian processing alias resolves", () => {
  const r = resolveColumn("Фактический срок ответа (дней)", DOMAIN_C);
  assert.equal(r.method, "EXACT_ALIAS"); assert.equal(r.canonicalId, "processing_time");
});
test("exact English days past due alias resolves", () => {
  assert.equal(resolveColumn("days past due", DOMAIN_A).method, "EXACT_ALIAS");
});
test("underscore and case variants resolve to the same concept", () => {
  for (const column of ["days_past_due", "Days Past Due", "DAYS PAST DUE"]) assert.equal(resolveColumn(column, DOMAIN_A).canonicalId, "delinquency_days");
  assert.equal(resolveColumn("DAYS PAST DUE", DOMAIN_A).method, "NORMALIZED_ALIAS");
});
test("exactOnly allows raw matches but never normalized or prefix matches", () => {
  assert.equal(resolveColumn("Статус обращения", DOMAIN_C).canonicalId, "request_status");
  for (const column of ["Статус обращения текущий", "СТАТУС ОБРАЩЕНИЯ", "Статус_обращения"]) assert.equal(resolveColumn(column, DOMAIN_C).canonicalId, null);
});
test("longest prefix alias wins independently of concept order", () => {
  const shorter = { ...concept("delinquency_days"), aliases: ["payment delay"], exactOnly: false };
  const longer = { ...concept("delinquency_count"), aliases: ["payment delay count"], exactOnly: false };
  for (const order of [[shorter, longer], [longer, shorter]]) withConcepts(order, () => {
    assert.equal(resolveColumn("payment delay count quarterly", DOMAIN_A).canonicalId, "delinquency_count");
  });
});
test("equal-strength ties return sorted explicit ambiguity without first-match", () => {
  const a = { ...concept("delinquency_days"), aliases: ["Delay_days"], exactOnly: false };
  const b = { ...concept("delinquency_count"), aliases: ["delay-days"], exactOnly: false };
  for (const order of [[a, b], [b, a]]) withConcepts(order, () => {
    for (const column of ["DELAY DAYS", "delay days quarterly"]) {
      const result = resolveColumn(column, DOMAIN_A);
      assert.equal(result.method, "AMBIGUOUS"); assert.equal(result.canonicalId, null);
      assert.deepEqual(result.candidates, ["delinquency_count", "delinquency_days"]);
    }
  });
});
test("unknown columns stay unresolved", () => {
  assert.equal(resolveColumn("unlisted business column", DOMAIN_A).method, "UNRESOLVED");
});
test("UNKNOWN domain resolves nothing, including canonical IDs", () => {
  assert.deepEqual(resolveDatasetColumns(["delinquency_days", "ID обращения"], "UNKNOWN").columns.map(c => c.canonicalId), [null, null]);
});
test("domain matches do not leak", () => {
  assert.equal(resolveColumn("delinquency_days", DOMAIN_B).canonicalId, null);
  assert.equal(resolveColumn("planned_progress", DOMAIN_A).canonicalId, null);
});
test("yo and ye spellings are equivalent for non-exactOnly concepts", () => {
  const a = resolveColumn("Оценка удовлетворённости", DOMAIN_C);
  const b = resolveColumn("ОЦЕНКА УДОВЛЕТВОРЕННОСТИ", DOMAIN_C);
  assert.equal(a.canonicalId, "satisfaction"); assert.equal(b.canonicalId, a.canonicalId);
});
test("slash normalization is resolver-local", () => {
  const r = resolveColumn("дата ответа / закрытия", DOMAIN_C);
  assert.equal(r.normalized, "дата ответа закрытия"); assert.equal(r.canonicalId, "completed_at");
  assert.equal(normalizeHeaderName("Дата ответа/закрытия"), "дата ответа/закрытия");
});
test("completion header keeps existing routing role OTHER", () => {
  assert.equal(normalizeHeader("Дата ответа/закрытия").semanticRole, "OTHER");
});
test("dangerous bare aliases never bind in any domain", () => {
  for (const domain of [DOMAIN_A, DOMAIN_B, DOMAIN_C]) for (const column of ["Срок", "Score", "ID", "Сумма", "Дата", "Тип", "Значение"]) assert.equal(resolveColumn(column, domain).canonicalId, null);
});
test("prefix aliases require six characters and a word boundary", () => {
  withConcepts([{ ...concept("delinquency_days"), aliases: ["DPD", "delay days"], exactOnly: false }], () => {
    assert.equal(resolveColumn("DPD monthly", DOMAIN_A).canonicalId, null);
    assert.equal(resolveColumn("delay dayssuffix", DOMAIN_A).canonicalId, null);
    assert.equal(resolveColumn("delay days monthly", DOMAIN_A).method, "PREFIX_ALIAS");
  });
});
test("NFKC, dashes, punctuation, whitespace and Russian case normalize locally", () => {
  assert.equal(resolveColumn("  ＤＡＹＳ—ＰＡＳＴ_due;  ", DOMAIN_A).normalized, "days past due");
  assert.equal(resolveColumn("  ＤＡＹＳ—ＰＡＳＴ_due;  ", DOMAIN_A).canonicalId, "delinquency_days");
});
test("dataset resolution preserves input column order and spelling", () => {
  const columns = ["DAYS PAST DUE", "unknown", "delinquency_days"];
  assert.deepEqual(resolveDatasetColumns(columns, DOMAIN_A).columns.map(c => c.column), columns);
});

test("text proposed as numeric is rejected", () => {
  assert.equal(validate(concept("delinquency_days"), ["a", "b", "c"]).verdict, "REJECTED");
});
test("low uniqueness identifiers are rejected", () => {
  assert.equal(validate(concept("client_id"), ["same", "same", "same", "same"]).verdict, "REJECTED");
});
test("unknown-header 0..180 values can structurally support delinquency days", () => {
  assert.equal(validate(concept("delinquency_days"), [0, 10, 30, 90, 180]).verdict, "STRUCTURALLY_CONFIRMED");
});
test("mixed percentage scales stay ambiguous without changing values", () => {
  const values = [0.2, 0.8, 20, 80]; const before = [...values];
  assert.equal(validate(concept("actual_progress", DOMAIN_B), values).verdict, "AMBIGUOUS");
  assert.deepEqual(values, before);
});
test("negative currency remains valid", () => {
  assert.equal(validate(concept("net_cash_flow"), [-100, 0, 100]).verdict, "STRUCTURALLY_CONFIRMED");
});
test("unknown repeat categories remain ambiguous without coercion", () => {
  const values = ["да", "нет", "жалоба"]; const before = [...values];
  assert.equal(validate(concept("repeat_request", DOMAIN_C), values).verdict, "AMBIGUOUS");
  assert.deepEqual(values, before);
});
test("Russian categorical-profile dates are confirmed by existing parser", () => {
  const name = "Дата и время обращения";
  const values = ["2026-01-01 10:00:00", "2026-01-02 11:00:00", "2026-01-03 12:00:00"];
  const profile = profileDataset({ name: "test", columns: [name], rows: values.map(v => ({ [name]: v })) }).columns[0];
  assert.equal(profile.kind, "categorical");
  assert.equal(validateProposedMapping(concept("submitted_at", DOMAIN_A), profile, values, values.length).verdict, "STRUCTURALLY_CONFIRMED");
});
test("satisfaction accepts each plausible scale unchanged", () => {
  for (const values of [[1, 3, 5], [1, 7, 10], [0, 50, 100]]) assert.equal(validate(concept("satisfaction", DOMAIN_C), values).verdict, "STRUCTURALLY_CONFIRMED");
});
test("invalid satisfaction scales are ambiguous", () => {
  for (const values of [[-1, 0, 1], [100, 150, 200]]) assert.equal(validate(concept("satisfaction", DOMAIN_C), values).verdict, "AMBIGUOUS");
});
test("DPD guard rejects negatives, fractions and values over 3650", () => {
  for (const values of [[-1, 0, 1], [0, 1.5, 2], [0, 1, 3651]]) assert.equal(validate(concept("delinquency_days"), values).verdict, "REJECTED");
});
test("overdue does not become repeat semantics even with boolean values", () => {
  assert.equal(validate(concept("repeat_request", DOMAIN_C), [true, false, true], "Просрочено").verdict, "AMBIGUOUS");
  assert.equal(validate(concept("repeat_request", DOMAIN_C), ["первичное", "повторное", "первичное"], "Тип обращения").verdict, "STRUCTURALLY_CONFIRMED");
});
test("count units reject negative and fractional values", () => {
  for (const values of [[0, 1, -2], [0, 1, 1.5]]) assert.equal(validate(concept("transaction_count"), values).verdict, "REJECTED");
});
test("ratio has no universal upper bound and score no assumed polarity", () => {
  assert.equal(validate(concept("dti"), [1, 2, 5]).verdict, "STRUCTURALLY_CONFIRMED");
  assert.equal(validate(concept("risk_score"), [-100, 0, 1000]).verdict, "STRUCTURALLY_CONFIRMED");
});
test("missingness, sparse samples and unparsed numeric values prevent confirmation", () => {
  for (const values of [[1, 2], [1, 2, 3, null], [1, 2, 3, "unknown"]]) assert.equal(validate(concept("risk_score"), values).verdict, "AMBIGUOUS");
});
test("identifier-like fractions contradict identifiers, distinct strings support them", () => {
  assert.equal(validate(concept("client_id"), [1.1, 2.2, 3.3]).verdict, "REJECTED");
  assert.equal(validate(concept("client_id"), ["C1", "C2", "C3"]).verdict, "STRUCTURALLY_CONFIRMED");
});
test("categorical variation and cardinality are checked conservatively", () => {
  const c = concept("region");
  assert.equal(validate(c, ["a", "a", "a", "b", "b"]).verdict, "STRUCTURALLY_CONFIRMED");
  assert.equal(validate(c, ["a", "a", "a"]).verdict, "AMBIGUOUS");
  assert.equal(validate(c, ["a", "b", "c", "d", "e"]).verdict, "AMBIGUOUS");
});
test("free text defaults to ambiguous", () => {
  assert.equal(validate({ ...concept("region"), dataType: "TEXT" }, ["one", "two", "three"]).verdict, "AMBIGUOUS");
});
test("invalid calendar dates and numeric epochs are rejected", () => {
  const c = concept("submitted_at", DOMAIN_A);
  for (const values of [["2026-02-30", "bad", "2026-13-01"], [1, 2, 3]]) assert.equal(validate(c, values).verdict, "REJECTED");
});
test("mismatched row counts and profiles remain ambiguous", () => {
  const values = [0, 1, 2];
  const profile = profileDataset({ name: "test", columns: ["x"], rows: values.map(x => ({ x })) }).columns[0];
  assert.equal(validateProposedMapping(concept("delinquency_days"), profile, values, 10).verdict, "AMBIGUOUS");
  assert.equal(validateProposedMapping(concept("delinquency_days"), { ...profile, unique: 1 }, values, 3).verdict, "AMBIGUOUS");
});
