import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeGeneric } from "../adapters/generic/analyze.ts";
import { buildPrecursorChain } from "../agentic/precursorChain.ts";
import { syntheticConstructionDataset } from "../construction/dataset.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import { bankClients } from "../universal/fixtures.ts";
import type { AdmissionRequest } from "../universal/contracts.ts";
import { createTimeSeriesArtifact, validateTimeSeriesArtifact, type TimeSeriesArtifact } from "./validator.ts";

function input(kind: "construction" | "fintech" = "construction"): AdmissionRequest {
  const dataset = kind === "construction" ? syntheticConstructionDataset() : fintechDemoDataset();
  return { dataset, signals: dataset.columns.filter((column) => column !== "date" && column !== "month"), taskId: kind, mapping: { target: kind === "construction" ? "schedule_gap_pp" : "portfolio_risk" } };
}
function firstRun(original: AdmissionRequest) {
  const analysis = analyzeGeneric(original.dataset, original.signals);
  return createTimeSeriesArtifact(original, { analysis, precursorChain: buildPrecursorChain(original.dataset, analysis, original.mapping?.target) });
}
function mutable(artifact: TimeSeriesArtifact) { return JSON.parse(JSON.stringify(artifact)) as { analysis: ReturnType<typeof analyzeGeneric>; precursorChain: ReturnType<typeof buildPrecursorChain> } & TimeSeriesArtifact; }

for (const kind of ["construction", "fintech"] as const) {
  test(`${kind} real demo deterministic outputs validate and retain stable repeated hashes`, () => {
    const original = input(kind);
    const artifact = firstRun(original);
    const result = validateTimeSeriesArtifact(original, artifact);
    assert.equal(result.status, "VALIDATED");
    assert.ok(result.checks.every((check) => check.passed));
    assert.match(result.validatedArtifactHash!, /^fnv1a-/);
    assert.equal(validateTimeSeriesArtifact(input(kind), firstRun(input(kind))).validatedArtifactHash, result.validatedArtifactHash);
    assert.equal(validateTimeSeriesArtifact(original, JSON.parse(JSON.stringify(artifact))).validatedArtifactHash, result.validatedArtifactHash);
  });
}
test("analysis tampering blocks validation without a validated hash", () => {
  const original = input(); const artifact = mutable(firstRun(original));
  assert.ok(artifact.analysis.findings.length);
  artifact.analysis.findings[0].mean += 1;
  const result = validateTimeSeriesArtifact(original, artifact);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.validatedArtifactHash, undefined);
  assert.equal(result.checks.find((check) => check.id === "TS_analysis")?.passed, false);
});
test("precursor edge tampering blocks validation", () => {
  const original = input(); const artifact = mutable(firstRun(original));
  assert.ok(artifact.precursorChain.edges.length);
  artifact.precursorChain.edges[0].correlation += 0.01;
  const result = validateTimeSeriesArtifact(original, artifact);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.checks.find((check) => check.id === "TS_precursorChain")?.passed, false);
  assert.equal(result.validatedArtifactHash, undefined);
});
test("source rows and original selections are independently bound", () => {
  const original = input(); const artifact = firstRun(original);
  const changed = structuredClone(original); changed.dataset.rows[0].workers = 1000;
  assert.equal(validateTimeSeriesArtifact(changed, artifact).status, "BLOCKED");
  assert.equal(validateTimeSeriesArtifact({ ...original, signals: original.signals.slice(1) }, artifact).status, "BLOCKED");
  assert.equal(validateTimeSeriesArtifact({ ...original, mapping: { target: "workers" } }, artifact).status, "BLOCKED");
});
test("artifact is a deep immutable detached snapshot", () => {
  const original = input(); const analysis = analyzeGeneric(original.dataset, original.signals);
  const chain = buildPrecursorChain(original.dataset, analysis, original.mapping?.target);
  const artifact = createTimeSeriesArtifact(original, { analysis, precursorChain: chain });
  const mean = artifact.analysis.findings[0].mean;
  analysis.findings[0].mean += 1;
  assert.equal(artifact.analysis.findings[0].mean, mean);
  assert.ok(Object.isFrozen(artifact)); assert.ok(Object.isFrozen(artifact.precursorChain.edges));
  assert.throws(() => { (artifact as unknown as { workflowId: string }).workflowId = "other"; }, TypeError);
});
test("agent interpretation and runtime state remain outside hash authority", () => {
  const original = input(); const artifact = firstRun(original);
  const response = { artifact, agentic: { hypothesis: "one", timings: 1, evidence: ["E-001"] }, validator: { challenge: "one" } };
  const hash = validateTimeSeriesArtifact(original, response.artifact).validatedArtifactHash;
  response.agentic = { hypothesis: "different", timings: 999, evidence: ["E-009"] };
  response.validator.challenge = "different";
  assert.equal(validateTimeSeriesArtifact(original, response.artifact).validatedArtifactHash, hash);
  assert.deepEqual(Object.keys(artifact).sort(), ["analysis", "dataset", "inputs", "precursorChain", "workflowId"]);
  assert.equal(validateTimeSeriesArtifact(original, { ...artifact, hypothesis: "injected" } as TimeSeriesArtifact).status, "BLOCKED");
});
test("non-finite numeric tampering is rejected rather than normalized", () => {
  const original = input(); const artifact = mutable(firstRun(original));
  artifact.analysis.findings[0].mean = Number.NaN;
  assert.equal(validateTimeSeriesArtifact(original, artifact).status, "BLOCKED");
});
test("cross-sectional source cannot acquire time-series validation", () => {
  const artifact = firstRun(input());
  const result = validateTimeSeriesArtifact({ dataset: bankClients, signals: ["DTI"] }, artifact);
  assert.equal(result.status, "BLOCKED"); assert.equal(result.validatedArtifactHash, undefined);
});
test("API validates actual workflow outputs before success and keeps the LLM validator separate", () => {
  const route = readFileSync(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.match(route, /createTimeSeriesArtifact\(admissionRequest, \{ analysis, precursorChain: agentic\.precursorChain \}\)/);
  assert.match(route, /validateTimeSeriesArtifact\(admissionRequest, artifact\)/);
  assert.match(route, /validation\.status !== "VALIDATED"/);
  assert.match(route, /kind: "TIME_SERIES", artifact, validation, analysis, investigator, validator, agentic/);
});
