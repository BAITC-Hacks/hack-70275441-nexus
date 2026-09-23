import { analyzeGeneric, type GenericAnalysis } from "../adapters/generic/analyze.ts";
import { buildPrecursorChain } from "../agentic/precursorChain.ts";
import type { PrecursorChain } from "../agentic/types.ts";
import { stableHash, stableStringify } from "../crossSectional/tools.ts";
import { admitInvestigation } from "../universal/admission.ts";
import type { AdmissionRequest } from "../universal/contracts.ts";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type TimeSeriesArtifact = Immutable<{
  workflowId: "generic-time-series-investigation";
  dataset: { name: string; version: string };
  inputs: { signals: string[]; date: string | null; target: string | null };
  analysis: GenericAnalysis;
  precursorChain: PrecursorChain;
}>;
export type TimeSeriesValidation = {
  status: "VALIDATED" | "BLOCKED";
  checks: { id: string; passed: boolean; detail: string }[];
  validatedArtifactHash?: string;
};

// Snapshot the JSON transport representation, rejecting invalid numeric authority.
// Optional undefined object fields are absent on the wire as in the existing API.
function snapshot<T>(value: T): T {
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-finite deterministic value.");
    return item;
  });
  const copy = JSON.parse(text) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}

/** Takes actual first-run deterministic outputs; never takes agent interpretation. */
export function createTimeSeriesArtifact(
  original: AdmissionRequest,
  output: { analysis: GenericAnalysis; precursorChain: PrecursorChain },
): TimeSeriesArtifact {
  return snapshot({
    workflowId: "generic-time-series-investigation" as const,
    dataset: { name: original.dataset.name, version: stableHash({ columns: original.dataset.columns, rows: original.dataset.rows }) },
    inputs: { signals: [...original.signals], date: original.mapping?.date ?? null, target: original.mapping?.target ?? null },
    analysis: output.analysis,
    precursorChain: output.precursorChain,
  });
}

/** Recomputes from source rows and the original admitted selections, not artifact values. */
export function validateTimeSeriesArtifact(original: AdmissionRequest, artifact: TimeSeriesArtifact): TimeSeriesValidation {
  const checks: TimeSeriesValidation["checks"] = [];
  const check = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const admission = admitInvestigation(original);
  check("TS_ADMISSION", admission.status === "PROCEED" && admission.workflowId === "generic-time-series-investigation", "Original inputs must admit the existing time-series workflow.");
  if (!checks[0].passed) return { status: "BLOCKED", checks };
  try {
    const analysis = analyzeGeneric(original.dataset, original.signals);
    const expected = createTimeSeriesArtifact(original, { analysis, precursorChain: buildPrecursorChain(original.dataset, analysis, original.mapping?.target) });
    const submitted = snapshot(artifact);
    for (const key of ["workflowId", "dataset", "inputs", "analysis", "precursorChain"] as const) {
      check(`TS_${key}`, stableStringify(submitted[key]) === stableStringify(expected[key]), `${key} must equal independent recomputation.`);
    }
    check("TS_ARTIFACT_SHAPE", stableStringify(Object.keys(submitted).sort()) === stableStringify(Object.keys(expected).sort()), "Only deterministic contract fields are admitted.");
    if (checks.every((item) => item.passed)) return { status: "VALIDATED", checks, validatedArtifactHash: stableHash(submitted) };
  } catch {
    check("TS_RECOMPUTATION", false, "Artifact or deterministic computation could not be represented safely.");
  }
  return { status: "BLOCKED", checks };
}
