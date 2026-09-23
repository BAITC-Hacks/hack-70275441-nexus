import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASK_REGISTRY,
  CURRENT_TASK_MODE,
  resolveTaskConfig,
  resolveToolPackForTask,
  resolveRuntimeToolPackScenario,
  taskObjectivePlaceholder,
  type NexusTaskConfig,
} from "./taskRegistry.ts";
import { resolveToolPack, genericPack } from "../agentic/resolveToolPack.ts";

test("the generic task resolves with no linked prepared scenario", () => {
  const task = resolveTaskConfig("generic");
  assert.ok(task);
  assert.equal(task.mode, "INVESTIGATE");
  assert.equal(task.toolPackScenario, "generic");
  assert.equal(task.scenario, undefined, "the bare generic task has no prepared demo case");
});

test("runtime capability resolves explicit task, confirmed domain and generic fallback deterministically", () => {
  assert.equal(resolveRuntimeToolPackScenario("synthetic", "RETAIL"), "generic", "an explicit known task owns execution capability");

  for (const taskId of [undefined, null, "generic"])
    assert.equal(resolveRuntimeToolPackScenario(taskId, "RETAIL"), "generic", "an ordinary confirmed upload with no dedicated pack falls back to generic");

  for (const domain of ["RETAIL", "LOGISTICS", "MANUFACTURING", "MINING", "AUTO / UNKNOWN", "does-not-exist", undefined])
    assert.equal(resolveRuntimeToolPackScenario("generic", domain), "generic", `${domain ?? "missing"} has no dedicated TIME_SERIES pack`);

  assert.equal(resolveRuntimeToolPackScenario("does-not-exist", "RETAIL"), "generic", "unknown explicit tasks fail closed");
});

test("runtime domain associations are unique and do not create a second domain registry", () => {
  const associations = TASK_REGISTRY.flatMap(task => task.domainId ? [task.domainId] : []);
  assert.equal(new Set(associations).size, associations.length);
  assert.deepEqual(associations.sort(), []);
});

test("the API delegates TIME_SERIES tool-pack choice to Task Registry without a domain branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const api = await readFile(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.match(api, /resolveRuntimeToolPackScenario\(body\.taskId, body\.domain\)/);
});

test("an unknown task id resolves to undefined rather than throwing", () => {
  assert.equal(resolveTaskConfig("does-not-exist"), undefined);
  assert.equal(resolveTaskConfig(null), undefined);
  assert.equal(resolveTaskConfig(undefined), undefined);
});

test("an unknown task id's tool pack falls back to the generic pack rather than throwing", () => {
  const fallbackPack = resolveToolPackForTask("does-not-exist");
  assert.equal(fallbackPack, resolveToolPack("generic"));
});

test("resolveToolPackForTask resolves to exactly the same pack instance the existing resolveToolPack already returns, for every registered task", () => {
  for (const task of TASK_REGISTRY) {
    assert.equal(
      resolveToolPackForTask(task.id),
      resolveToolPack(task.toolPackScenario),
      `${task.id} must resolve to the same pack resolveToolPack("${task.toolPackScenario}") already returns`,
    );
  }
});

test("the registry does not mutate or clone the underlying tool-pack arrays — repeated resolution returns the identical reference", () => {
  const snapshot = JSON.stringify(genericPack);
  const first = resolveToolPackForTask("generic");
  const second = resolveToolPackForTask("generic");
  assert.equal(first, second, "two lookups for the same task must return the identical array reference, not a copy");
  assert.equal(JSON.stringify(genericPack), snapshot, "resolving a tool pack through the registry must never mutate the source pack");
});

test("every currently registered task runs in INVESTIGATE mode, matching CURRENT_TASK_MODE", () => {
  assert.equal(CURRENT_TASK_MODE, "INVESTIGATE");
  for (const task of TASK_REGISTRY) {
    assert.equal(task.mode, "INVESTIGATE", `${task.id} was expected to still be INVESTIGATE — OPTIMIZE/MATCH/ANALYZE are declared but unimplemented`);
  }
});

test("taskObjectivePlaceholder falls back from an explicit override, to the linked scenario's objective, to an empty string", () => {
  const withOverride: NexusTaskConfig = { id: "x", label: "x", mode: "INVESTIGATE", toolPackScenario: "generic", objectivePlaceholder: "Explicit override wins." };
  assert.equal(taskObjectivePlaceholder(withOverride), "Explicit override wins.");

  const syntheticTask = resolveTaskConfig("synthetic");
  assert.equal(taskObjectivePlaceholder(syntheticTask), syntheticTask?.scenario?.objective);

  const bareGeneric = resolveTaskConfig("generic");
  assert.equal(taskObjectivePlaceholder(bareGeneric), "");
  assert.equal(taskObjectivePlaceholder(undefined), "");
});
