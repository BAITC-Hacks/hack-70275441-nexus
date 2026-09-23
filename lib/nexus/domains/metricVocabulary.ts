import type { DomainMetricDefinition, MetricRole, RiskDirection } from "./types.ts";
import { uniqueMetricAliases } from "./metricAliases.ts";
export type MetricRow = readonly [string, string, string, RiskDirection, string];
/** Explicit vocabulary only. Units are declared, never inferred from uploaded values or converted. */
export function metricVocabulary(rows: readonly MetricRow[], outcomes: readonly string[] = []): Readonly<Record<string, DomainMetricDefinition>> {
  return Object.fromEntries(rows.map(([canonicalName, labelRu, unit, riskDirection, aliases]) => [canonicalName, {
    canonicalName, labelRu, unit, riskDirection, role: (outcomes.includes(canonicalName) ? "outcome" : "context") as MetricRole,
    valueType: unit === "%" ? "percentage" : unit === "pp" ? "percentage_points" : unit === "KZT" ? "currency" : unit === "hours" ? "hours" : unit === "people" || unit === "count" ? "count" : unit === "index" ? "index" : "continuous",
    aliases: uniqueMetricAliases(canonicalName, aliases.split("|").filter(Boolean)), description: "Declared domain vocabulary; units require source-data confirmation. No causal finding or automatic value conversion.",
  }]));
}
