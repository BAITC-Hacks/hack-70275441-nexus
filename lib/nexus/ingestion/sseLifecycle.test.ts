import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";

type UiState = { step: string; error: string; results?: unknown };

async function runWorkspaceWith(fetchResponse: () => Promise<Response>): Promise<UiState> {
  const source = readFileSync(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const run = async () => {");
  const end = source.indexOf("  const reset =", start);
  assert.ok(start >= 0 && end > start, "the workspace investigation handler must exist");
  const wrapper = `export function makeRun(env) { const {dataset,isEventTransaction,signals,routeTaskId,domain,objective,date,target,setStep,setError,setProgress,setResponseDelayed,setResults,fetch,window}=env; ${source.slice(start, end)} return run; }`;
  const js = transpileModule(wrapper, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
  const { makeRun } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const state: UiState = { step: "review", error: "" };
  const run = makeRun({
    dataset: { name: "fixture", columns: ["id"], rows: [{ id: 1 }] },
    isEventTransaction: false, signals: ["id"], routeTaskId: "generic", domain: "AUTO / UNKNOWN", objective: "", date: "", target: "",
    setStep: (value: string) => { state.step = value; },
    setError: (value: string) => { state.error = value; },
    setProgress: () => {}, setResponseDelayed: () => {},
    setResults: (value: unknown) => { state.results = value; },
    fetch: fetchResponse, window: { clearTimeout, setTimeout },
  });
  await run();
  return state;
}

test("a valid SSE result reaches results and an explicit SSE error returns to review", async () => {
  const success = await runWorkspaceWith(async () => new Response('event: result\ndata: {"kind":"CROSS_SECTIONAL","artifact":{},"validation":{}}\n\n'));
  assert.equal(success.step, "results");
  assert.deepEqual(success.results, { kind: "CROSS_SECTIONAL", artifact: {}, validation: {} });
  const failure = await runWorkspaceWith(async () => new Response('event: error\ndata: {"error":"server failed"}\n\n'));
  assert.equal(failure.step, "review");
  assert.equal(failure.error, "server failed");
});

test("HTTP failure and interrupted response stream return to review", async () => {
  const http = await runWorkspaceWith(async () => Response.json({ error: "bad request" }, { status: 422 }));
  assert.equal(http.step, "review");
  assert.equal(http.error, "bad request");
  const interrupted = await runWorkspaceWith(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: progress\ndata: {"stage":"OBSERVER","source":"DETERMINISTIC","detail":"ok"}\n\n')); controller.error(new Error("network interrupted")); },
  })));
  assert.equal(interrupted.step, "review");
  assert.equal(interrupted.error, "network interrupted");
});

test("HTTP 200 with progress but no terminal event cannot leave the workspace running", async () => {
  const state = await runWorkspaceWith(async () => new Response('event: progress\ndata: {"stage":"OBSERVER","source":"DETERMINISTIC","detail":"ok"}\n\n'));
  assert.equal(state.step, "review");
  assert.match(state.error, /поток|заверш|результат/i);
  assert.equal(state.results, undefined);
});

test("an incomplete terminal SSE frame at EOF cannot leave the workspace running", async () => {
  const state = await runWorkspaceWith(async () => new Response('event: result\ndata: {"kind":"CROSS_SECTIONAL","artifact":{},"validation":{}}'));
  assert.equal(state.step, "review");
  assert.match(state.error, /поток|заверш|результат/i);
  assert.equal(state.results, undefined);
});
