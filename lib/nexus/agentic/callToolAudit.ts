import type { CallToolMetadataOutcome } from "./boundedRuntime/runtime.ts";

/** Public assumption under test, not hidden reasoning or computed facts. */
export function validateTargetedAssumption(raw: Record<string, unknown>, containsMetric: (value: unknown) => boolean): CallToolMetadataOutcome {
  const text = typeof raw.targetedAssumption === "string" ? raw.targetedAssumption.trim() : "";
  if (!text || text.length > 240) return { ok: false, reason: "INVALID_TARGETED_ASSUMPTION" };
  if (containsMetric({ targetedAssumption: text })) return { ok: false, reason: "AUTHORITATIVE_METRIC_REJECTED" };
  return { ok: true, metadata: { targetedAssumption: text } };
}
