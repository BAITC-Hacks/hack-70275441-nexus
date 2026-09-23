import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { requestLlm, createLlmAudit, LlmRequestFailure, classifyLlmError, LLM_REQUEST_TIMEOUT_MS } from "./llmRequest.ts";
import { runBoundedAgent } from "./boundedRuntime/runtime.ts";

test("fast completion measures attempt and total latency independently", async () => {
  const result = await requestLlm({ agent: "INVESTIGATOR", request: async () => "ok" });
  assert.equal(result.value, "ok");
  assert.equal(result.metadata.status, "COMPLETED");
  assert.equal(result.metadata.timeoutMs, LLM_REQUEST_TIMEOUT_MS);
  assert.equal(result.metadata.attempts, 1);
  assert.equal(result.metadata.attemptTrace[0].status, "COMPLETED");
  assert.ok(result.metadata.latencyMs >= result.metadata.attemptTrace[0].latencyMs);
});

for (const [category, error] of [
  ["TIMEOUT", new DOMException("secret", "TimeoutError")],
  ["RATE_LIMIT", Object.assign(new Error("secret"), { status: 429 })],
  ["SERVER_ERROR", Object.assign(new Error("secret"), { status: 500 })],
  ["NETWORK_ERROR", Object.assign(new Error("secret"), { code: "ECONNRESET" })],
] as const) test(`${category} retries once with fresh signal and succeeds`, async () => {
  const signals: AbortSignal[] = [];
  const result = await requestLlm({ agent: "SKEPTIC", retryDelayMs: 0, request: async signal => { signals.push(signal); if (signals.length === 1) throw error; return "ok"; } });
  assert.equal(result.metadata.attempts, 2);
  assert.equal(result.metadata.status, "COMPLETED");
  assert.equal(result.metadata.attemptTrace[0].errorCategory, category);
  assert.equal(result.metadata.attemptTrace[1].status, "COMPLETED");
  assert.notEqual(signals[0], signals[1]);
  assert.equal(result.metadata.errorCategory, undefined);
});

test("hard timeout bounds even a transport ignoring abort; both attempts fail safely", async () => {
  const signals: AbortSignal[] = [];
  await assert.rejects(requestLlm({ agent: "INVESTIGATOR", timeoutMs: 5, retryDelayMs: 0, request: signal => { signals.push(signal); return new Promise(() => {}); } }), error => {
    assert.ok(error instanceof LlmRequestFailure);
    assert.equal(error.metadata.status, "FALLBACK");
    assert.equal(error.metadata.errorCategory, "TIMEOUT");
    assert.equal(error.metadata.attempts, 2);
    assert.ok(error.metadata.attemptTrace.every(attempt => attempt.errorCategory === "TIMEOUT" && attempt.latencyMs >= 4));
    assert.ok(error.metadata.latencyMs >= error.metadata.attemptTrace.reduce((sum, attempt) => sum + attempt.latencyMs, 0));
    return true;
  });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test("first real deadline aborts before second attempt succeeds", async () => {
  let attempts = 0;
  const result = await requestLlm({ agent: "INVESTIGATOR", timeoutMs: 5, retryDelayMs: 0, request: async () => ++attempts === 1 ? new Promise<string>(() => {}) : "ok" });
  assert.equal(result.metadata.attempts, 2);
  assert.equal(result.metadata.attemptTrace[0].errorCategory, "TIMEOUT");
});

test("nonretryable 400/401/403/404/422 and unknown errors never exceed one attempt or expose raw payload", async () => {
  for (const status of [400, 401, 403, 404, 422, undefined]) {
    let attempts = 0;
    await assert.rejects(requestLlm({ agent: "INVESTIGATOR", request: async () => { attempts++; throw Object.assign(new Error("sk-secret raw body"), { status, code: "sk-secret", body: { authorization: "sk-secret" } }); } }), error => {
      assert.ok(error instanceof LlmRequestFailure);
      assert.equal(error.metadata.attempts, 1);
      assert.equal(error.metadata.errorCategory, status ? "MODEL_ERROR" : "UNKNOWN_ERROR");
      assert.doesNotMatch(JSON.stringify(error), /sk-secret|authorization|raw body/);
      assert.doesNotMatch(error.message, /sk-secret|raw body/);
      return true;
    });
    assert.equal(attempts, 1);
  }
  assert.equal(classifyLlmError(Object.assign(new Error(), { name: "APIConnectionError" })), "NETWORK_ERROR");
  assert.equal(classifyLlmError(new OpenAI.APIConnectionError({ message: "secret" })), "NETWORK_ERROR");
  assert.equal(classifyLlmError(new OpenAI.APIConnectionTimeoutError()), "TIMEOUT");
  assert.equal(classifyLlmError(new OpenAI.APIUserAbortError()), "TIMEOUT");
});

test("persistent transient failure never executes more than two attempts", async () => {
  let attempts = 0;
  await assert.rejects(requestLlm({ agent: "INVESTIGATOR", retryDelayMs: 0, request: async () => { attempts++; throw Object.assign(new Error("payload"), { status: 503 }); } }), LlmRequestFailure);
  assert.equal(attempts, 2);
});

test("structured output rejection is audited without a retry; missing key means zero attempts", async () => {
  const audit = createLlmAudit("INVESTIGATOR");
  await audit.request(async () => "not JSON");
  const result = audit.finish("JSON_PARSE_FAILURE", "INVALID_STRUCTURED_OUTPUT");
  assert.equal(result.status, "FALLBACK");
  assert.equal(result.attempts, 1);
  assert.equal(result.steps[0].status, "FALLBACK");
  assert.equal(result.steps[0].errorCategory, "INVALID_STRUCTURED_OUTPUT");
  assert.equal(createLlmAudit("SKEPTIC").finish("MISSING_API_KEY").attempts, 0);
});

const boundedInput = {
  role: "INVESTIGATOR" as const, model: "mock", system: "", tools: [], context: {},
  evidence: [{ id: "E-001", tool: "baseline", variables: [], result: "observed", data: {}, usedBy: [] }],
  budgets: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 5 }, buildSchema: () => ({}), buildPayload: () => ({}), schemaName: "test",
  validateTerminal: (raw: Record<string, unknown>) => raw.hypothesis === "observed" ? { ok: true as const, terminal: raw } : { ok: false as const, reason: "INVALID_EVIDENCE_REFERENCE" },
};

test("bounded runtime retry changes only transport attempts, not turn or tool budgets", async () => {
  let attempts = 0;
  let payloadBuilds = 0, schemaBuilds = 0;
  const result = await runBoundedAgent({ ...boundedInput, buildPayload: () => { payloadBuilds++; return {}; }, buildSchema: () => { schemaBuilds++; return {}; }, request: async () => { if (++attempts === 1) throw Object.assign(new Error("secret"), { status: 429 }); return JSON.stringify({ hypothesis: "observed" }); } });
  assert.equal(result.source, "LLM");
  assert.equal(result.llmCalls, 1);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.call.retryCount, 1);
  assert.equal(result.call.runtime!.attempts, 2);
  assert.equal(result.call.runtime!.status, "COMPLETED");
  assert.equal(payloadBuilds, 1);
  assert.equal(schemaBuilds, 1);
});

test("late output after timed-out attempts cannot execute a tool or generate Evidence", async () => {
  let executions = 0;
  const result = await runBoundedAgent({ ...boundedInput,
    tools: [{ name: "late_tool", description: "late", allowedAgents: ["INVESTIGATOR"], argumentKind: "none", execute: () => { executions++; return { summary: "result", variables: [], data: {} }; } }],
    request: () => new Promise(resolve => setTimeout(() => resolve('{"action":"CALL_TOOL","tool":"late_tool","id":"NONE"}'), 20)),
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(result.source, "FALLBACK");
  assert.equal(result.call.runtime!.attempts, 2);
  assert.equal(executions, 0);
  assert.equal(result.newEvidence.length, 0);
});

test("bounded invalid JSON/null/array/business rejection never retries or crashes pipeline", async () => {
  for (const text of ["not JSON", "null", "[]", '{"hypothesis":"invented"}']) {
    let attempts = 0;
    const result = await runBoundedAgent({ ...boundedInput, request: async () => { attempts++; return text; } });
    assert.equal(attempts, 1);
    assert.equal(result.source, "FALLBACK");
    assert.equal(result.call.outcome, "SCHEMA_ERROR");
    assert.equal(result.call.runtime!.status, "FALLBACK");
    assert.equal(result.call.runtime!.errorCategory, text.includes("invented") ? "MODEL_ERROR" : "INVALID_STRUCTURED_OUTPUT");
  }
});
