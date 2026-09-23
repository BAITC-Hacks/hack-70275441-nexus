import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(projectRoot, "app/globals.css"), "utf8");
// Several of these selectors (.agent-pipeline span, .tool-cards article, ...) also have an earlier, unrelated
// base-layout declaration elsewhere in this single large stylesheet. All lookups below must be anchored to
// start searching from the motion-enhancement section itself, not just the first occurrence of the selector.
const motionSectionStart = css.indexOf("Bounded motion enhancement");
assert.ok(motionSectionStart >= 0, "expected to find the 'Bounded motion enhancement' CSS section");

/**
 * Guards the continuous "living" motion added on top of the existing one-shot stagger reveal: Risk Chain
 * cards, agent-stage cards and Evidence cards must keep drifting gently after they appear; arrows/connectors
 * must not; and `prefers-reduced-motion: reduce` must be able to shut all of it off. These are structural
 * checks against the actual CSS source — there is no component-rendering test harness in this project, and
 * this project doesn't want one just for this (see docs/task-adaptation-quickref.md's "do not touch unless
 * necessary" list), so the CSS text itself is the thing under test, the same way namingGuard.test.ts checks
 * component source directly.
 */

test("Risk Chain cards, agent-stage cards and Evidence cards each carry an infinite alternating drift animation", () => {
  for (const [label, selector] of [
    ["Risk Chain card", ".mission-control .cascade-flow .cascade-node{"],
    ["agent-stage card", ".agent-pipeline span{"],
    ["Evidence card", ".tool-cards article{"],
  ]) {
    const start = css.indexOf(selector, motionSectionStart);
    assert.ok(start >= 0, `expected to find the ${label} rule (${selector}) inside the motion section`);
    const block = css.slice(start, css.indexOf("}", css.indexOf("}", start) + 1) + 1);
    assert.match(block, /card-drift/, `${label} must include the card-drift animation`);
    assert.match(block, /infinite/, `${label}'s drift must be infinite (continuous), not one-shot`);
    assert.match(block, /alternate/, `${label}'s drift must alternate direction, not restart abruptly`);
    assert.match(block, /ease-in-out/, `${label}'s drift must ease in and out, not move linearly`);
  }
});

test("arrows/connectors never get the continuous drift — only the one-shot reveal", () => {
  for (const selector of [".mission-control .cascade-flow .cascade-arrow{", ".agent-pipeline i{"]) {
    const start = css.indexOf(selector, motionSectionStart);
    assert.ok(start >= 0, `expected to find the arrow rule (${selector}) inside the motion section`);
    const block = css.slice(start, css.indexOf("}", start) + 1);
    assert.doesNotMatch(block, /card-drift/, `${selector} must stay static after reveal — arrows/connectors must not drift`);
  }
});

test("the drift keyframe is transform-only — no scale, rotation, or box-shadow/opacity pulsing", () => {
  const keyframeStart = css.indexOf("@keyframes card-drift");
  assert.ok(keyframeStart >= 0, "expected a card-drift @keyframes block");
  const keyframeBlock = css.slice(keyframeStart, css.indexOf("}}", keyframeStart) + 2);
  assert.match(keyframeBlock, /transform:translate\(/, "card-drift must animate transform: translate(...)");
  assert.doesNotMatch(keyframeBlock, /scale\(|rotate\(|box-shadow|opacity/, "card-drift must not scale, rotate, glow, or fade — only a small translate");
});

test("card-drift amplitude stays within the requested subtle range (2-4px vertical, ≤2px horizontal) for Risk Chain and agent-stage cards, and is weaker for Evidence cards", () => {
  const chainAmplitude = css.match(/\.mission-control \.cascade-flow \.cascade-node\{\s*--drift-x:([\d.]+)px;--drift-y:(-?[\d.]+)px;/);
  const pipelineAmplitude = css.match(/\.agent-pipeline span\{\s*--drift-x:([\d.]+)px;--drift-y:(-?[\d.]+)px;/);
  const evidenceAmplitude = css.match(/\.tool-cards article\{\s*--drift-x:([\d.]+)px;--drift-y:(-?[\d.]+)px;/);
  assert.ok(chainAmplitude && pipelineAmplitude && evidenceAmplitude, "expected --drift-x/--drift-y to be declared on all three card groups");
  const [, chainX, chainY] = chainAmplitude!;
  const [, pipelineX, pipelineY] = pipelineAmplitude!;
  const [, evidenceX, evidenceY] = evidenceAmplitude!;
  assert.ok(Math.abs(Number(chainY)) >= 2 && Math.abs(Number(chainY)) <= 4, `Risk Chain vertical drift ${chainY}px should be within 2-4px`);
  assert.ok(Number(chainX) <= 2, `Risk Chain horizontal drift ${chainX}px should be at most ~2px`);
  assert.ok(Math.abs(Number(pipelineY)) >= 2 && Math.abs(Number(pipelineY)) <= 4, `agent-stage vertical drift ${pipelineY}px should be within 2-4px`);
  assert.ok(Number(pipelineX) <= 2, `agent-stage horizontal drift ${pipelineX}px should be at most ~2px`);
  assert.ok(Math.abs(Number(evidenceY)) < Math.abs(Number(chainY)), "Evidence card drift must be weaker (smaller) than Risk Chain drift");
  assert.ok(Number(evidenceX) < Number(chainX), "Evidence card horizontal drift must be weaker than Risk Chain's");
});

test("card-drift duration stays within the requested 4-7 second range and differs per card via --stagger", () => {
  const durations = [...css.matchAll(/card-drift calc\(([\d.]+)s \+ var\(--stagger,0\) \* ([\d.]+)s\)/g)];
  assert.ok(durations.length >= 3, "expected a per-card-group card-drift duration formula for all three card groups");
  for (const [, base] of durations) {
    assert.ok(Number(base) >= 4 && Number(base) <= 7, `card-drift base duration ${base}s should be within the requested 4-7s range`);
  }
});

test("reduced motion zeroes the animation delay for every drifting card group, and the existing global rule already caps duration/iterations", () => {
  const reducedMotionBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reducedMotionBlock, /\.mission-control \.cascade-flow \.cascade-node,[\s\S]*\.tool-cards article\{animation-delay:0s!important\}/, "the reduced-motion override must still cover the Risk Chain, agent-stage and Evidence card selectors");
  // The global blanket rule (near the top of the reduced-motion handling) forces animation-duration to ~0
  // and animation-iteration-count to 1, which stops "infinite" after a single near-instant run.
  assert.match(css, /\*\{transition-duration:\.001ms!important;animation-duration:\.001ms!important;animation-iteration-count:1!important/, "expected the existing global reduced-motion rule that caps duration/iteration-count for every animation, including card-drift");
});
