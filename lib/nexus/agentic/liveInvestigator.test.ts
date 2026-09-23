import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `liveInvestigator.ts` imports `"server-only"`, a Next.js-only package not installed as a standalone
 * dependency — importing this module under raw `node --test` fails with MODULE_NOT_FOUND (verified: the
 * import throws before any of its own code runs). So, the same way `namingGuard.test.ts`/`motionGuard.test.ts`
 * check component/CSS source directly because there is no rendering harness in this project, this test
 * reads the source text to guard the one thing the language-consistency fix changed here: when
 * `OPENAI_API_KEY` is unavailable (or the LLM call fails), the fallback hypothesis NEXUS shows on the
 * Result page and in the PDF must be Russian, not English — a Russian UI must never silently revert to
 * English just because the live agent could not run.
 */
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const source = readFileSync(path.join(projectRoot, "lib/nexus/agentic/liveInvestigator.ts"), "utf8");

test("the Investigator's fallback hypothesis (used when no OPENAI_API_KEY is set, or the live call fails) is Russian", () => {
  assert.match(source, /primary: "Live Investigator не завершил работу/);
  assert.match(source, /alternative: "Тренд, сезонность/);
  assert.match(source, /limitations: \["Решение LLM-агента недоступно\./);
});

test("the old English fallback hypothesis text no longer appears in liveInvestigator.ts", () => {
  assert.doesNotMatch(source, /Live Investigator did not complete; deterministic observations/);
  assert.doesNotMatch(source, /Trend, seasonality, measurement variation/);
  assert.doesNotMatch(source, /Live LLM decision unavailable\./);
  assert.doesNotMatch(source, /Correlation does not establish causality\./);
});

test("the fallback's supportingEvidence still passes through raw Evidence IDs — only the narrative text was translated", () => {
  assert.match(source, /supportingEvidence: evidence\.map\(\(item\) => item\.id\)/);
});
