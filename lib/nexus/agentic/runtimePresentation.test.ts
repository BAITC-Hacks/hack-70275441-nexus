import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { createLlmAudit, LlmRequestFailure } from "./llmRequest.ts";

test("technical runtime trace shows completed, recovered retry and fallback truthfully", async () => {
  const source = await readFile(new URL("../../../components/nexus/workspace/AgentRuntimeTrace.tsx", import.meta.url), "utf8");
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { AgentRuntimeTrace, runtimeSourceLabel, runtimeFallbackMessage, DELAYED_AGENT_MESSAGE } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const audit = createLlmAudit("INVESTIGATOR");
  let attempts = 0;
  await audit.request(async () => { if (++attempts === 1) throw Object.assign(new Error("sk-secret"), { status: 429 }); return "ok"; });
  const html = renderToStaticMarkup(createElement(AgentRuntimeTrace, { runtime: [audit.finish()] }));
  // One audit.request() call that internally retried once is ONE reasoning step (steps.length === 1) that
  // needed 2 transport attempts — AI Steps must report step count, not the old summed-attempts value.
  assert.match(html, /AI COMPLETED/); assert.match(html, /<dt>AI Steps<\/dt><dd>1<\/dd>/); assert.match(html, /<dt>Total AI time<\/dt>/); assert.match(html, /RATE_LIMIT/); assert.match(html, /Transport metadata ≠ Evidence/);
  assert.doesNotMatch(html, /AI FALLBACK|sk-secret|<dt>Attempts<\/dt>|<dt>Latency<\/dt>/);
  assert.match(html, /attempts 2/); // the per-step detail keeps its own transport-attempts count
  const failing = createLlmAudit("SKEPTIC");
  await assert.rejects(failing.request(() => new Promise(() => {}), 5), LlmRequestFailure);
  const fallback = renderToStaticMarkup(createElement(AgentRuntimeTrace, { runtime: [failing.finish("TIMEOUT")] }));
  assert.match(fallback, /AI FALLBACK/); assert.match(fallback, /TIMEOUT/); assert.match(fallback, /Attempt 2/);
  assert.doesNotMatch(fallback, /AI COMPLETED/);
  assert.doesNotMatch(fallback, /<dt>Attempts<\/dt>|<dt>Latency<\/dt>/);
  const workspace = await readFile(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  // 1 TIME_SERIES decision-view technical drawer (runtime=) + 1 each for EventTransaction/CrossSectional (calls=).
  // The old no-Domain-Pack fallback's own separate TECHNICAL TRACE drawer no longer exists — every TIME_SERIES
  // result now reaches the one decision-view drawer.
  assert.equal(workspace.match(/<AgentRuntimeTrace/g)?.length, 3);
  assert.ok(workspace.indexOf('<AgentRuntimeTrace calls=') > workspace.indexOf('<summary>TECHNICAL TRACE · Трассировка агентов</summary>'));
  const api = await readFile(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(api, /fallbackReason: "timeout" as const/);
  assert.equal(runtimeSourceLabel("FALLBACK"), "РЕЗЕРВНЫЙ РЕЖИМ");
  assert.match(DELAYED_AGENT_MESSAGE, /AI-агент отвечает дольше обычного/);
  assert.doesNotMatch(DELAYED_AGENT_MESSAGE, /Оператор/i);
  assert.match(runtimeFallbackMessage("TIMEOUT"), /не был получен в установленный срок/);
  for (const category of ["RATE_LIMIT", "NETWORK_ERROR", "SERVER_ERROR", "INVALID_STRUCTURED_OUTPUT", "MODEL_ERROR", "UNKNOWN_ERROR"]) assert.doesNotMatch(runtimeFallbackMessage(category), /срок|TIMEOUT|timeout/i);
  assert.doesNotMatch(source + workspace, /ОТСТУПАТЬ|Отступать/);
});

test("serialized TIME_SERIES Investigator and Skeptic diagnostics render in the actual Construction technical drawer", async () => {
  const source = await readFile(new URL("../../../components/nexus/workspace/AgentRuntimeTrace.tsx", import.meta.url), "utf8");
  const compile = (code: string) => transpileModule(code, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { AgentRuntimeTrace, runtimeSourceLabel } = await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
  const workspace = await readFile(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  const start = workspace.indexOf('<div className="raw-trace"><h3>TECHNICAL TRACE');
  assert.ok(start > workspace.indexOf('<summary>Технические детали и Evidence</summary>'));
  const jsx = workspace.slice(start, workspace.indexOf('</div>', start) + 6);
  const wrapper = `export function DrawerAudit({results,AgentRuntimeTrace,runtimeSourceLabel}){ const agentic=results.agentic; return (${jsx}); }`;
  const { DrawerAudit } = await import(`data:text/javascript;base64,${Buffer.from(compile(wrapper)).toString("base64")}`);
  // steps: one realistic LlmStepTrace entry — a single reasoning step, either completed in one transport
  // attempt or (fallback case) exhausted at 2 transport attempts within that same one step. AI Steps must
  // read steps.length (always 1 here), independent of how many transport attempts that one step needed.
  const fixture = (agent: string, category?: string) => ({ agent, status: category ? "FALLBACK" : "COMPLETED", attempts: category ? 2 : 1, latencyMs: category ? 30100 : 4200, errorCategory: category, steps: [{ agent, status: category ? "FAILED" : "COMPLETED", attempts: category ? 2 : 1, latencyMs: category ? 30100 : 4200, timeoutMs: 15000, errorCategory: category, attemptTrace: category ? [{ attempt: 1, status: "FAILED", latencyMs: 15000, errorCategory: category }, { attempt: 2, status: "FAILED", latencyMs: 15100, errorCategory: category }] : [{ attempt: 1, status: "COMPLETED", latencyMs: 4200 }] }], rawPrompt: "private-prompt", responseBody: "private-body", apiKey: "sk-private", headers: { authorization: "private-header" }, stack: "private-stack" });
  for (const category of [undefined, "TIMEOUT", "RATE_LIMIT", "NETWORK_ERROR", "SERVER_ERROR", "INVALID_STRUCTURED_OUTPUT", "MODEL_ERROR", "UNKNOWN_ERROR"]) {
    // SSE's JSON boundary and the UI's result state retain operational fields for both roles.
    const results = JSON.parse(JSON.stringify({ kind: "TIME_SERIES", agentic: { investigator: { runtime: fixture("INVESTIGATOR", category) }, skeptic: { runtime: fixture("SKEPTIC", category) }, trace: [] } }));
    const html = renderToStaticMarkup(createElement(DrawerAudit, { results, AgentRuntimeTrace, runtimeSourceLabel }));
    assert.match(html, /INVESTIGATOR/); assert.match(html, /SKEPTIC/);
    assert.equal(html.match(/<dt>Status<\/dt>/g)?.length, 2);
    assert.equal(html.match(/<dt>AI Steps<\/dt><dd>1<\/dd>/g)?.length, 2);
    assert.equal(html.match(/<dt>Total AI time<\/dt><dd>(30\.1|4\.2) s<\/dd>/g)?.length, 2);
    assert.doesNotMatch(html, /<dt>Attempts<\/dt>|<dt>Latency<\/dt>/);
    if (category) { assert.match(html, /AI FALLBACK/); assert.ok(html.includes(`<dt>Error</dt><dd>${category}</dd>`)); }
    else { assert.match(html, /AI COMPLETED/); assert.match(html, /<dt>Error<\/dt><dd>—<\/dd>/); }
    if (category !== "TIMEOUT") assert.doesNotMatch(html, /TIMEOUT|установлен/i);
    assert.doesNotMatch(html, /private-prompt|private-body|sk-private|private-header|private-stack|ОТСТУПАТЬ/);
    assert.match(html, /translate="no"/);
  }
  const orchestrator = await readFile(new URL("./orchestrator.ts", import.meta.url), "utf8");
  assert.match(orchestrator, /runtime: liveInvestigator\.runtime/); assert.match(orchestrator, /runtime: liveSkeptic\.runtime/);
  const api = await readFile(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.match(api, /event\("result", \{ kind: "TIME_SERIES", artifact, validation, analysis, investigator, validator, agentic \}\)/);
  // Existing CS/ET call records continue through their unchanged technical path.
  assert.equal(workspace.match(/<AgentRuntimeTrace calls=\{artifact.technicalTrace.agentCalls\}/g)?.length, 2);
  for (const workflow of ["CROSS_SECTIONAL", "EVENT_TRANSACTION"]) {
    const calls = ["INVESTIGATOR", "SKEPTIC"].map(role => ({ agentRole: role, model: "test-model", startedAt: "2026-09-14T10:00:00Z", runtime: fixture(role, "NETWORK_ERROR"), outcome: "API_ERROR", toolCalls: 0, retryCount: 1 }));
    const html = renderToStaticMarkup(createElement(AgentRuntimeTrace, { calls }));
    assert.match(html, /INVESTIGATOR/); assert.match(html, /SKEPTIC/);
    assert.match(html, /<dt>Error<\/dt><dd>NETWORK_ERROR<\/dd>/, workflow);
    assert.doesNotMatch(html, /TIMEOUT|private-prompt|private-body/);
  }
});

test("summary uses AI Steps / Total AI time; per-step ATTEMPTS is untouched — mirrors the confirmed Construction live-agent smoke (2 completed steps, each 1 attempt)", async () => {
  const source = await readFile(new URL("../../../components/nexus/workspace/AgentRuntimeTrace.tsx", import.meta.url), "utf8");
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { AgentRuntimeTrace } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const audit = createLlmAudit("INVESTIGATOR");
  await audit.request(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return "step1"; });
  await audit.request(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return "step2"; });
  const html = renderToStaticMarkup(createElement(AgentRuntimeTrace, { runtime: [audit.finish()] }));
  // 1. Summary shows AI Steps (= steps.length, here 2 distinct reasoning steps).
  assert.match(html, /<dt>AI Steps<\/dt><dd>2<\/dd>/);
  // 2. Summary shows Total AI time (= summed step latency, already correct — presentation-only rename).
  assert.match(html, /<dt>Total AI time<\/dt><dd>\d+\.\d s<\/dd>/);
  // 3. Summary no longer shows the old aggregated "Attempts"/"Latency" labels at all.
  assert.doesNotMatch(html, /<dt>Attempts<\/dt>|<dt>Latency<\/dt>/);
  // 4. Each individual reasoning step still reports its own transport-attempts count unchanged.
  assert.equal(html.match(/attempts 1/g)?.length, 2);
});
