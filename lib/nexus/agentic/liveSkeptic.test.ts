import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `liveSkeptic.ts` imports `"server-only"`, a Next.js-only package not installed as a standalone
 * dependency — importing this module under raw `node --test` fails with MODULE_NOT_FOUND (verified: the
 * import throws before any of its own code runs). So, the same way `namingGuard.test.ts`/`motionGuard.test.ts`
 * check component/CSS source directly because there is no rendering harness in this project, this test
 * reads the source text to guard the one thing the language-consistency fix changed here: when
 * `OPENAI_API_KEY` is unavailable (or the LLM call fails), the fallback verdict NEXUS shows on the Result
 * page and in the PDF must be Russian, not English — a Russian UI must never silently revert to English
 * just because the live agent could not run.
 */
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const source = readFileSync(path.join(projectRoot, "lib/nexus/agentic/liveSkeptic.ts"), "utf8");

test("the Skeptic's fallback verdict (used when no OPENAI_API_KEY is set, or the live call fails) is Russian", () => {
  assert.match(source, /challenge:\s*\n\s*"Live Skeptic не завершил проверку/);
  assert.match(source, /alternatives: \["Тренд или сезонность", "Погрешность измерения"\]/);
});

test("the old English fallback verdict text no longer appears in liveSkeptic.ts", () => {
  assert.doesNotMatch(source, /Live Skeptic did not complete; deterministic evidence/);
  assert.doesNotMatch(source, /\["Trend or seasonality", "Measurement artifact"\]/);
});

test("the fallback status stays the canonical INCONCLUSIVE enum value — only the narrative text was translated", () => {
  assert.match(source, /status: "INCONCLUSIVE"/);
});
