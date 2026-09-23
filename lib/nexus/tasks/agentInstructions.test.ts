import { test } from "node:test";
import assert from "node:assert/strict";
import { INVESTIGATOR_SYSTEM_INSTRUCTIONS, SKEPTIC_SYSTEM_INSTRUCTIONS } from "./agentInstructions.ts";

/**
 * The language-consistency fix adds exactly one requirement to each agent's system prompt: write
 * user-facing narrative fields in Russian, while keeping canonical IDs/Evidence IDs/tool names intact.
 * Everything else about these instructions — reasoning workflow, tool-selection behavior, the evidence
 * standard, and the ban on inventing values/causality/hidden reasoning — must survive unchanged.
 */
test("both agents are instructed to write user-facing narrative fields in Russian", () => {
  for (const instructions of [INVESTIGATOR_SYSTEM_INSTRUCTIONS, SKEPTIC_SYSTEM_INSTRUCTIONS]) {
    assert.match(instructions, /Write all user-facing narrative fields in Russian\./);
    assert.match(instructions, /Preserve canonical field IDs, Evidence IDs and tool names when technically required\./);
  }
});

test("both agents are still told never to reveal chain-of-thought or internal reasoning", () => {
  for (const instructions of [INVESTIGATOR_SYSTEM_INSTRUCTIONS, SKEPTIC_SYSTEM_INSTRUCTIONS]) {
    assert.match(instructions, /Never reveal chain-of-thought or internal reasoning steps/i);
  }
});

test("the pre-existing reasoning/tool-selection/evidence rules are unchanged by the language addition", () => {
  assert.match(INVESTIGATOR_SYSTEM_INSTRUCTIONS, /You decide what to inspect; deterministic tools calculate all numerical evidence\./);
  assert.match(INVESTIGATOR_SYSTEM_INSTRUCTIONS, /Never invent columns, metrics, values, causality, probabilities, or hidden reasoning\./);
  assert.match(SKEPTIC_SYSTEM_INSTRUCTIONS, /Challenge a candidate explanation using deterministic tools\./);
  assert.match(SKEPTIC_SYSTEM_INSTRUCTIONS, /Never calculate or invent numerical evidence, probabilities, or causal proof\./);
});
