import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SCENARIOS } from "./scenarios.ts";

/**
 * Prepared-scenario objectives are shown to the user verbatim (Command Center pre-fill, OBJECTIVE banner,
 * RESULT header, PDF section 1) — unlike a user-typed objective, which NEXUS must never rewrite, a prepared
 * scenario's own objective is scenario/display configuration NEXUS controls, so it must read as Russian
 * from the start rather than leaking the English case-authoring language into the Russian experience.
 */
test("every prepared scenario's objective is Russian — none of them leak the English authoring language", () => {
  for (const scenario of DEMO_SCENARIOS) {
    assert.match(scenario.objective, /[А-Яа-яЁё]/, `${scenario.id}'s objective must be Russian`);
    assert.doesNotMatch(scenario.objective, /^Investigate\b/i, `${scenario.id}'s objective must not be the English case-authoring sentence`);
  }
});
