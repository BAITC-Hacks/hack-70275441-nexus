import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { proposeSemanticMappings, validateSemanticProposals } from "./semanticResolver.ts";
import type { SemanticResolverInput, SemanticColumnInput, SemanticRequestFn, SemanticResolverOutcome } from "./semanticResolver.ts";
import { DOMAIN_PACKS, getDomainConcept } from "./registry.ts";
import type { CanonicalConcept, DomainId, DomainPack } from "./types.ts";
import { profileDataset } from "../ingestion/profileDataset.ts";
import type { CellValue } from "../ingestion/types.ts";

/**
 * No registered domain declares any `concepts` today (see resolution.test.ts's note) — this file's
 * synthetic vocabulary stands in for what a new domain's `concepts` would look like once one is added.
 */
const metric = (over: Partial<CanonicalConcept> & Pick<CanonicalConcept, "canonicalId" | "dataType">): CanonicalConcept => ({
  kind: "METRIC", labelRu: over.canonicalId, labelEn: over.canonicalId, aliases: [], ...over,
});
const CONCEPTS_RETAIL: CanonicalConcept[] = [
  metric({ canonicalId: "delinquency_days", dataType: "NUMERIC", unitFamily: "DAYS" }),
  metric({ canonicalId: "risk_score", dataType: "NUMERIC", unitFamily: "SCORE" }),
  { ...metric({ canonicalId: "region", dataType: "CATEGORICAL" }), kind: "DIMENSION" },
  metric({ canonicalId: "transaction_timestamp", dataType: "DATETIME" }),
];
const CONCEPTS_MANUFACTURING: CanonicalConcept[] = [
  metric({ canonicalId: "submitted_at", dataType: "DATETIME", labelRu: "Дата поступления" }),
];
const originals = new Map<DomainId, DomainPack>();
before(() => {
  const registry = DOMAIN_PACKS as Record<DomainId, DomainPack>;
  for (const [id, concepts] of [["RETAIL", CONCEPTS_RETAIL], ["MANUFACTURING", CONCEPTS_MANUFACTURING]] as const) {
    originals.set(id, registry[id]);
    registry[id] = { ...registry[id], concepts };
  }
});
after(() => {
  const registry = DOMAIN_PACKS as Record<DomainId, DomainPack>;
  for (const [id, pack] of originals) registry[id] = pack;
});

const header = "Количество суток нарушения графика";
const numbers = [0, 10, 30, 90, 180];
const dpd = getDomainConcept("RETAIL", "delinquency_days")!;
function column(name = header, values: CellValue[] = numbers): SemanticColumnInput {
  const profile = profileDataset({ name: "fixture", columns: [name], rows: values.map(value => ({ [name]: value })) }).columns[0];
  return { column: name, normalized: name.toLowerCase(), kind: profile.kind, unique: profile.unique, missingPercent: profile.missingPercent, sampleValues: values,
    neighborColumns: { before: ["loan_id", "payment_id"], after: ["monthly_payment", "contract_id"] } };
}
function input(columns: SemanticColumnInput[] = [column()]): SemanticResolverInput {
  return { domain: "RETAIL", rowCount: 5, objective: "Inspect loan payment delinquency", columns, candidateConcepts: [dpd] };
}
function proposal(name = header, id = "delinquency_days", reason = "Header describes payment delay in days.") {
  return { column: name, proposedCanonicalId: id, reason, candidateAlternatives: [] };
}
const reply = (...proposals: ReturnType<typeof proposal>[]) => JSON.stringify({ proposals });
const fake = (...proposals: ReturnType<typeof proposal>[]): SemanticRequestFn => async () => reply(...proposals);
const assertFallback = (result: SemanticResolverOutcome, reason: string) => {
  assert.equal(result.source, "FALLBACK");
  if (result.source === "FALLBACK") { assert.equal(result.fallbackReason, reason); assert.deepEqual(result.proposals, []); }
};
function validationContext(values: CellValue[] = numbers, name = header) {
  return { domain: "RETAIL" as const, rowCount: values.length, columns: [{ values, profile: profileDataset({ name: "fixture", columns: [name], rows: values.map(value => ({ [name]: value })) }).columns[0] }] };
}
type Payload = { objective: string; columns: { column: string; sampleValues: string[]; neighborColumns: { before: string[]; after: string[] }; candidates: { canonicalId: string }[] }[] };

test("zero unresolved columns is a deterministic no-op", async () => {
  let calls = 0;
  assertFallback(await proposeSemanticMappings(input([]), { request: async () => { calls++; return reply(); } }), "NO_UNRESOLVED_COLUMNS");
  assert.equal(calls, 0);
});
test("already resolved aliases never call the semantic model", async () => {
  let calls = 0;
  assertFallback(await proposeSemanticMappings(input([column("delinquency_days")]), { request: async () => { calls++; return reply(); } }), "NO_UNRESOLVED_COLUMNS");
  assert.equal(calls, 0);
});
test("UNKNOWN domain makes no request", async () => {
  let calls = 0;
  assertFallback(await proposeSemanticMappings({ ...input(), domain: "UNKNOWN" }, { request: async () => { calls++; return reply(); } }), "UNKNOWN_DOMAIN");
  assert.equal(calls, 0);
});
test("no structurally compatible candidates makes no request", async () => {
  let calls = 0;
  assertFallback(await proposeSemanticMappings(input([column(header, ["a", "b", "c", "d", "e"])]), { request: async () => { calls++; return reply(); } }), "NO_COMPATIBLE_CANDIDATES");
  assert.equal(calls, 0);
});
test("multiple unresolved columns share exactly one request", async () => {
  const other = "Нарушение графика договора"; let calls = 0;
  const result = await proposeSemanticMappings(input([column(), column(other)]), { request: async args => {
    calls++; assert.equal((args.payload as Payload).columns.length, 2); return reply(proposal(), proposal(other));
  } });
  assert.equal(calls, 1); assert.equal(result.proposals.length, 2);
});
test("valid proposal remains explicitly a proposal", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake(proposal()) });
  assert.equal(result.source, "LLM"); assert.deepEqual(result.proposals, [proposal()]);
  assert.ok(!("accepted" in result));
});
test("canonical ID outside shortlist cannot escape", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: fake(proposal(header, "risk_score")) }), "SCHEMA_VALIDATION_FAILURE");
});
test("invented alternative cannot escape either", async () => {
  const p = { ...proposal(), candidateAlternatives: ["invented_metric"] };
  assertFallback(await proposeSemanticMappings(input(), { request: async () => JSON.stringify({ proposals: [p] }) }), "SCHEMA_VALIDATION_FAILURE");
});
test("malformed JSON falls back", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: async () => "{broken" }), "JSON_PARSE_FAILURE");
});
test("timeout is enforced even when injected request ignores abort", async () => {
  let calls = 0; let signal: AbortSignal | undefined;
  assertFallback(await proposeSemanticMappings(input(), { timeoutMs: 5, request: async args => { calls++; signal = args.signal; return new Promise<string>(() => {}); } }), "TIMEOUT");
  assert.equal(calls, 1); assert.equal(signal?.aborted, true);
});
test("missing API key returns fallback before network", async () => {
  assertFallback(await proposeSemanticMappings(input(), { apiKey: "" }), "MISSING_API_KEY");
});
test("API failure is non-blocking and not retried", async () => {
  let calls = 0;
  assertFallback(await proposeSemanticMappings(input(), { request: async () => { calls++; throw new Error("API unavailable"); } }), "API_ERROR");
  assert.equal(calls, 1);
});
test("SDK timeout exceptions are classified as timeout", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: async () => { const error = new Error("timeout"); error.name = "APIConnectionTimeoutError"; throw error; } }), "TIMEOUT");
});
test("deterministic full-column validation confirms a compatible proposal", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake(proposal()) });
  const mapping = validateSemanticProposals(result, validationContext())[0];
  assert.equal(mapping.source, "LLM_PROPOSED"); assert.equal(mapping.structuralValidation.verdict, "STRUCTURALLY_CONFIRMED");
});
test("numeric contradiction in full values rejects a semantic proposal", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake(proposal()) });
  assert.equal(validateSemanticProposals(result, validationContext(["a", "b", "c", "d", "e"]))[0].structuralValidation.verdict, "REJECTED");
});
test("full-column missingness leaves proposal ambiguous", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake(proposal()) });
  assert.equal(validateSemanticProposals(result, validationContext([0, 10, 30, null, null]))[0].structuralValidation.verdict, "AMBIGUOUS");
});
test("unfamiliar delinquency phrase survives the unrestricted practical shortlist", async () => {
  const result = await proposeSemanticMappings({ ...input(), candidateConcepts: undefined }, { request: async args => {
    const candidates = (args.payload as Payload).columns[0].candidates;
    assert.ok(candidates.some(c => c.canonicalId === "delinquency_days")); assert.ok(candidates.length <= 15);
    return reply(proposal());
  } });
  assert.equal(result.source, "LLM");
  assert.equal(validateSemanticProposals(result, validationContext())[0].structuralValidation.verdict, "STRUCTURALLY_CONFIRMED");
});
test("same phrase with incompatible strings never becomes accepted DPD", async () => {
  const result = await proposeSemanticMappings(input([column(header, ["first", "second", "third", "fourth", "fifth"])]), { request: fake(proposal()) });
  assertFallback(result, "NO_COMPATIBLE_CANDIDATES"); assert.deepEqual(validateSemanticProposals(result, validationContext()), []);
});
test("bare Срок with weak context has no accepted mapping", async () => {
  const c = { ...column("Срок"), neighborColumns: { before: [], after: [] } }; let calls = 0;
  assertFallback(await proposeSemanticMappings({ ...input([c]), objective: "" }, { request: async () => { calls++; return reply(proposal("Срок")); } }), "NO_COMPATIBLE_CANDIDATES");
  assert.equal(calls, 0);
});
test("Score never silently becomes risk_score", async () => {
  const c = { ...column("Score"), neighborColumns: { before: [], after: [] } };
  assertFallback(await proposeSemanticMappings({ ...input([c]), objective: "", candidateConcepts: [getDomainConcept("RETAIL", "risk_score")!] }, { request: fake(proposal("Score", "risk_score")) }), "NO_COMPATIBLE_CANDIDATES");
});
test("all dangerous bare headers can abstain without a request", async () => {
  let calls = 0;
  const columns = ["Срок", "Score", "ID", "Сумма", "Дата", "Тип", "Значение"].map(name => ({ ...column(name), neighborColumns: { before: [], after: [] } }));
  assertFallback(await proposeSemanticMappings({ ...input(columns), objective: "" }, { request: async () => { calls++; return reply(); } }), "NO_COMPATIBLE_CANDIDATES");
  assert.equal(calls, 0);
});
test("categorical-profile Russian dates retain DATETIME candidates", async () => {
  const name = "Метка поступления";
  const values = ["2026-01-01 10:00:00", "2026-01-02 11:00:00", "2026-01-03 12:00:00"];
  const c = column(name, values); assert.equal(c.kind, "categorical");
  const candidate = getDomainConcept("MANUFACTURING", "submitted_at")!;
  const result = await proposeSemanticMappings({ domain: "MANUFACTURING", rowCount: 3, objective: "Request submission time", columns: [c], candidateConcepts: [candidate] }, { request: async args => {
    assert.ok((args.payload as Payload).columns[0].candidates.some(c => c.canonicalId === "submitted_at")); return reply(proposal(name, "submitted_at", "Header marks request submission time."));
  } });
  const context = { ...validationContext(values, name), domain: "MANUFACTURING" as const };
  assert.equal(validateSemanticProposals(result, context)[0].structuralValidation.verdict, "STRUCTURALLY_CONFIRMED");
});
test("reason is bounded without silent truncation", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: fake(proposal(header, "delinquency_days", "x".repeat(201))) }), "SCHEMA_VALIDATION_FAILURE");
});
test("unsupported numeric claims and confidence percentages are rejected", async () => {
  for (const reason of ["Default rate is 90%.", "Mean delay is 12 days."]) assertFallback(await proposeSemanticMappings(input(), { request: fake(proposal(header, "delinquency_days", reason)) }), "SCHEMA_VALIDATION_FAILURE");
});
test("one bad proposal does not discard a valid proposal for another column", async () => {
  const other = "Нарушение графика договора";
  const result = await proposeSemanticMappings(input([column(), column(other)]), { request: fake(proposal(), proposal(other, "invented_concept")) });
  assert.equal(result.source, "LLM"); assert.deepEqual(result.proposals, [proposal()]);
  if (result.source === "LLM") assert.deepEqual(result.invalidProposals, [{ column: other, reason: "SCHEMA_VALIDATION_FAILURE" }]);
});
test("empty valid response represents model abstention", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake() });
  assert.equal(result.source, "LLM"); assert.deepEqual(result.proposals, []);
});
test("schema enforces each column's own concept enum", async () => {
  await proposeSemanticMappings(input(), { request: async args => {
    const schema = args.schema as { properties: { proposals: { items: { anyOf: { properties: { column: { enum: string[] }; proposedCanonicalId: { enum: string[] }; candidateAlternatives: { items: { enum: string[] } } } }[] } } } };
    const branch = schema.properties.proposals.items.anyOf[0];
    assert.deepEqual(branch.properties.column.enum, [header]); assert.deepEqual(branch.properties.proposedCanonicalId.enum, ["delinquency_days"]);
    assert.deepEqual(branch.properties.candidateAlternatives.items.enum, ["delinquency_days"]);
    return reply();
  } });
});
test("samples, neighbors and objective are bounded without mutation", async () => {
  const name = "Новая территория";
  const values = Array.from({ length: 20 }, (_, i) => `region ${i} ${"x".repeat(300)}`);
  const c = { ...column(name, values), neighborColumns: { before: ["far", "older", "region", "nearest"], after: ["region", "next", "far", "further"] } };
  const original = JSON.stringify(c);
  const result = await proposeSemanticMappings({ domain: "RETAIL", rowCount: 20, objective: "region ".repeat(200), columns: [c], candidateConcepts: [getDomainConcept("RETAIL", "region")!] }, { request: async args => {
    const p = args.payload as Payload;
    assert.equal(p.columns[0].sampleValues.length, 8); assert.ok(p.columns[0].sampleValues.every(value => value.length <= 160));
    assert.deepEqual(p.columns[0].neighborColumns, { before: ["region", "nearest"], after: ["region", "next"] });
    assert.ok(p.objective.length <= 500);
    assert.ok(!("values" in p.columns[0])); return reply();
  } });
  assert.equal(result.source, "LLM"); assert.equal(JSON.stringify(c), original);
});
test("null samples are omitted in favor of non-null values", async () => {
  const c = { ...column(), sampleValues: [null, null, ...numbers, null] };
  await proposeSemanticMappings(input([c]), { request: async args => {
    assert.deepEqual((args.payload as Payload).columns[0].sampleValues, numbers.map(String)); return reply();
  } });
});
test("caller metadata cannot invent a canonical concept or cross-domain candidate", async () => {
  assertFallback(await proposeSemanticMappings({ ...input(), candidateConcepts: [{ ...dpd, canonicalId: "fabricated" }] }, { request: fake(proposal()) }), "NO_COMPATIBLE_CANDIDATES");
});
test("duplicate proposals for one column are controlled schema failures", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: fake(proposal(), proposal()) }), "SCHEMA_VALIDATION_FAILURE");
});
test("extra schema properties cannot escape", async () => {
  assertFallback(await proposeSemanticMappings(input(), { request: async () => JSON.stringify({ proposals: [{ ...proposal(), confidence: "certain" }] }) }), "SCHEMA_VALIDATION_FAILURE");
});
test("missing validation context is ambiguous and alternatives are not auto-selected", async () => {
  const result = await proposeSemanticMappings(input(), { request: fake(proposal()) });
  const mappings = validateSemanticProposals(result, { domain: "RETAIL", rowCount: 5, columns: [] });
  assert.equal(mappings.length, 1); assert.equal(mappings[0].proposedCanonicalId, "delinquency_days"); assert.equal(mappings[0].structuralValidation.verdict, "AMBIGUOUS");
});
test("validation helper rejects nonexistent canonical concepts", () => {
  const outcome: SemanticResolverOutcome = { source: "LLM", proposals: [proposal(header, "invented")], invalidProposals: [] };
  assert.equal(validateSemanticProposals(outcome, validationContext())[0].structuralValidation.verdict, "REJECTED");
});
test("oversized batches and duplicate input names fall back without request", async () => {
  let calls = 0; const request: SemanticRequestFn = async () => { calls++; return reply(); };
  assertFallback(await proposeSemanticMappings(input(Array.from({ length: 33 }, (_, i) => column(`Unknown column ${i}`))), { request }), "SCHEMA_VALIDATION_FAILURE");
  assertFallback(await proposeSemanticMappings(input([column(), column()]), { request }), "SCHEMA_VALIDATION_FAILURE"); assert.equal(calls, 0);
});
test("model defaults and prompt contract follow the existing operational family", async () => {
  await proposeSemanticMappings(input(), { request: async args => {
    assert.equal(args.model, process.env.OPENAI_MODEL || "gpt-5-nano"); assert.ok(args.signal instanceof AbortSignal);
    assert.match(args.system, /Prefer abstention/); assert.match(args.system, /deterministic structural validation remains authoritative/); return reply();
  } });
});
test("a candidate approved for another column cannot leak across schema branches", async () => {
  const name = "Метка операции";
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
  const result = await proposeSemanticMappings({ ...input([column(), column(name, dates)]), objective: "Loan payment delinquency and transaction timestamp", candidateConcepts: [dpd, getDomainConcept("RETAIL", "transaction_timestamp")!] }, { request: fake(proposal(), proposal(name)) });
  assert.equal(result.source, "LLM"); assert.deepEqual(result.proposals, [proposal()]);
  if (result.source === "LLM") assert.equal(result.invalidProposals[0].column, name);
});
test("browser-like imports are blocked before requests can execute", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  try {
    const modulePath = "./semanticResolver.ts?server-only-test";
    await assert.rejects(import(modulePath), /server-only/);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});
