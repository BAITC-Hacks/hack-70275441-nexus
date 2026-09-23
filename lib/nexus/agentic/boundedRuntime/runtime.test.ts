import { test } from "node:test";
import assert from "node:assert/strict";
import { runBoundedAgent, type BoundedTool, type TerminalOutcome } from "./runtime.ts";
import type { EvidenceRecord } from "../types.ts";

type FakeContext = { entities: string[] };
type FakeTerminal = { hypothesis: string; evidenceRefs: string[] };

const revealTool: BoundedTool<FakeContext> = { name: "reveal_summary", description: "reveal", allowedAgents: ["INVESTIGATOR"], argumentKind: "none", execute: () => ({ summary: "summary revealed", data: { ok: true }, variables: [] }) };
const lookupTool: BoundedTool<FakeContext> = { name: "lookup_entity", description: "lookup", allowedAgents: ["INVESTIGATOR", "SKEPTIC"], argumentKind: "id", validIds: (ctx) => ctx.entities, execute: (_ctx, id) => ({ summary: `looked up ${id}`, data: { id }, variables: [id!] }) };
const skepticOnlyTool: BoundedTool<FakeContext> = { name: "skeptic_only", description: "skeptic only", allowedAgents: ["SKEPTIC"], argumentKind: "none", execute: () => ({ summary: "skeptic only ran", data: {}, variables: [] }) };
const tools = [revealTool, lookupTool, skepticOnlyTool];
const context: FakeContext = { entities: ["A-1", "A-2"] };
const baseline: EvidenceRecord[] = [{ id: "E-001", tool: "profile", variables: [], result: "baseline", data: {}, usedBy: ["OBSERVER"] }];

const validateTerminal = (raw: Record<string, unknown>, evidence: EvidenceRecord[]): TerminalOutcome<FakeTerminal> => {
  const refs = Array.isArray(raw.evidenceRefs) ? (raw.evidenceRefs as string[]) : [];
  if (typeof raw.hypothesis !== "string") return { ok: false, reason: "SCHEMA_VALIDATION_FAILURE" };
  if (!refs.length || !refs.every((id) => evidence.some((item) => item.id === id))) return { ok: false, reason: "INVALID_EVIDENCE_REFERENCE" };
  return { ok: true, terminal: { hypothesis: raw.hypothesis, evidenceRefs: refs } };
};

function baseInput(overrides: Partial<Parameters<typeof runBoundedAgent<FakeContext, FakeTerminal>>[0]> = {}) {
  return {
    role: "INVESTIGATOR" as const, model: "test-model", system: "system prompt", tools, context, evidence: baseline,
    budgets: { maxTurns: 2, maxToolCalls: 2, timeoutMs: 1000 }, schemaName: "test_schema", buildSchema: () => ({}), buildPayload: () => ({}),
    validateTerminal, ...overrides,
  };
}

test("workflow metadata is validated and preserved without altering arguments or deterministic Evidence", async () => {
  let turn = 0;
  const input = baseInput({ request: async () => JSON.stringify(turn++ ? { hypothesis: "final", evidenceRefs: ["E-002"] } : { action: "CALL_TOOL", tool: "lookup_entity", id: "A-1", assumption: "  Source identity is reliable.  " }), validateCallToolMetadata: raw => {
    const assumption = String(raw.assumption).trim();
    raw.id = "A-2"; raw.tool = "skeptic_only";
    return { ok: true, metadata: { assumption, id: "A-2", evidenceId: "E-999" } };
  } });
  const result = await runBoundedAgent(input);
  assert.equal(result.source, "LLM");
  assert.equal(result.toolTrace[0].id, "A-1");
  assert.equal(result.toolTrace[0].tool, "lookup_entity");
  assert.equal(result.toolTrace[0].evidenceId, "E-002");
  assert.equal(result.toolTrace[0].metadata!.assumption, "Source identity is reliable.");
  assert.deepEqual(result.newEvidence[0].data, { id: "A-1", requestedId: "A-1" });
  assert.deepEqual(baseline[0].data, {});
});

test("invalid or throwing workflow metadata fails explicitly before deterministic execution", async () => {
  for (const validateCallToolMetadata of [() => ({ ok: false as const, reason: "BAD_ASSUMPTION" }), () => { throw new Error("invalid metadata"); }]) {
    const result = await runBoundedAgent(baseInput({ request: async () => JSON.stringify({ action: "CALL_TOOL", tool: "reveal_summary", id: "NONE" }), validateCallToolMetadata }));
    assert.equal(result.call.outcome, "SCHEMA_ERROR");
    assert.ok(["BAD_ASSUMPTION", "INVALID_TOOL_METADATA"].includes(result.call.fallbackReason!));
    assert.equal(result.newEvidence.length, 0);
    assert.equal(result.toolCalls, 0);
  }
});

test("normal duplicate and budget checks run before the workflow metadata hook", async () => {
  for (const duplicate of [true, false]) {
    let turns = 0, validations = 0;
    const result = await runBoundedAgent(baseInput({ budgets: { maxTurns: 4, maxToolCalls: 1, timeoutMs: 1000 }, request: async () => JSON.stringify({ action: "CALL_TOOL", tool: duplicate || turns++ === 0 ? "reveal_summary" : "lookup_entity", id: duplicate || turns === 1 ? "NONE" : "A-1" }), validateCallToolMetadata: () => { validations++; return { ok: true, metadata: { assumption: "Check source." } }; } }));
    assert.equal(result.call.fallbackReason, duplicate ? "DUPLICATE_TOOL_CALL" : "TOOL_CALL_BUDGET_EXCEEDED");
    assert.equal(result.toolCalls, 1);
    assert.equal(validations, 1);
  }
});

test("an allowed tool call executes for real and appends new Evidence that continues the id sequence", async () => {
  let call = 0;
  const request = async () => { call += 1; return call === 1 ? JSON.stringify({ action: "CALL_TOOL", tool: "reveal_summary", id: "NONE" }) : JSON.stringify({ action: "FORM_HYPOTHESIS", hypothesis: "final", evidenceRefs: ["E-002"] }); };
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "LLM");
  assert.equal(result.llmCalls, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.newEvidence.length, 1);
  assert.equal(result.newEvidence[0].id, "E-002");
  assert.equal(result.newEvidence[0].tool, "reveal_summary");
  assert.equal(result.newEvidence[0].usedBy[0], "INVESTIGATOR");
  assert.deepEqual(result.toolTrace, [{ role: "INVESTIGATOR", tool: "reveal_summary", id: null, evidenceId: "E-002" }]);
  assert.equal(result.call.outcome, "LIVE_AGENT");
});

test("a response with no action field defaults to an immediate terminal answer (backward compatible with pre-tool-calling mocks)", async () => {
  const request = async () => JSON.stringify({ hypothesis: "final", evidenceRefs: ["E-001"] });
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "LLM");
  assert.equal(result.llmCalls, 1);
  assert.equal(result.toolCalls, 0);
});

test("a tool not allowed for this role is never executed", async () => {
  const request = async () => JSON.stringify({ action: "CALL_TOOL", tool: "skeptic_only", id: "NONE" });
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "INVALID_TOOL_CALL");
  assert.equal(result.toolCalls, 0);
  assert.equal(result.newEvidence.length, 0);
});

test("an id outside the deterministic valid-id set is rejected without executing", async () => {
  const request = async () => JSON.stringify({ action: "CALL_TOOL", tool: "lookup_entity", id: "GHOST-99" });
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "INVALID_TOOL_CALL");
  assert.equal(result.toolCalls, 0);
});

test("a valid id executes the tool and records it as provenance in the new Evidence's data", async () => {
  let call = 0;
  const request = async () => { call += 1; return call === 1 ? JSON.stringify({ action: "CALL_TOOL", tool: "lookup_entity", id: "A-1" }) : JSON.stringify({ action: "FORM_HYPOTHESIS", hypothesis: "final", evidenceRefs: ["E-002"] }); };
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "LLM");
  assert.equal(result.newEvidence[0].data.requestedId, "A-1");
  assert.deepEqual(result.toolTrace[0], { role: "INVESTIGATOR", tool: "lookup_entity", id: "A-1", evidenceId: "E-002" });
});

test("a repeated identical tool call is rejected rather than executed twice", async () => {
  let call = 0;
  const request = async () => { call += 1; return JSON.stringify({ action: "CALL_TOOL", tool: "reveal_summary", id: "NONE" }); };
  const result = await runBoundedAgent(baseInput({ request, budgets: { maxTurns: 3, maxToolCalls: 5, timeoutMs: 1000 } }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "DUPLICATE_TOOL_CALL");
  assert.equal(result.toolCalls, 1, "the first call must have executed for real before the duplicate was rejected");
});

test("the tool-call budget is enforced — a second distinct tool call beyond the budget is rejected", async () => {
  let call = 0;
  const request = async () => { call += 1; return call === 1 ? JSON.stringify({ action: "CALL_TOOL", tool: "reveal_summary", id: "NONE" }) : JSON.stringify({ action: "CALL_TOOL", tool: "lookup_entity", id: "A-1" }); };
  const result = await runBoundedAgent(baseInput({ request, budgets: { maxTurns: 3, maxToolCalls: 1, timeoutMs: 1000 } }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "TOOL_CALL_BUDGET_EXCEEDED");
  assert.equal(result.toolCalls, 1);
});

test("a timed-out request falls back explicitly with the exact reason", async () => {
  const request = ({ signal }: { signal: AbortSignal }) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const result = await runBoundedAgent(baseInput({ request, budgets: { maxTurns: 2, maxToolCalls: 2, timeoutMs: 5 } }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.outcome, "TIMEOUT");
  assert.equal(result.call.fallbackReason, "TIMEOUT");
});

test("malformed JSON falls back explicitly with a distinguishable diagnostic", async () => {
  const request = async () => "not-json";
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.outcome, "SCHEMA_ERROR");
  assert.equal(result.call.fallbackReason, "JSON_PARSE_FAILURE");
});

test("no API key and no injected request falls back immediately with zero LLM calls", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await runBoundedAgent(baseInput());
    assert.equal(result.source, "FALLBACK");
    assert.equal(result.llmCalls, 0);
    assert.equal(result.call.fallbackReason, "MISSING_API_KEY");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});

test("citing an Evidence ID that does not exist is rejected — evidence reference integrity is enforced", async () => {
  const request = async () => JSON.stringify({ action: "FORM_HYPOTHESIS", hypothesis: "final", evidenceRefs: ["E-999"] });
  const result = await runBoundedAgent(baseInput({ request }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "INVALID_EVIDENCE_REFERENCE");
});

test("a thrown deterministic tool exception is caught and produces an explicit fallback, never an unhandled rejection", async () => {
  const throwingTool: BoundedTool<FakeContext> = { name: "explodes", description: "throws", allowedAgents: ["INVESTIGATOR"], argumentKind: "none", execute: () => { throw new Error("boom"); } };
  const request = async () => JSON.stringify({ action: "CALL_TOOL", tool: "explodes", id: "NONE" });
  const result = await runBoundedAgent(baseInput({ tools: [throwingTool], request }));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.fallbackReason, "TOOL_EXECUTION_FAILED");
});
