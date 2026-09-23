import { listDomainPacks, lookupMetricAlias } from "./registry.ts";
import { normalizeMetricAlias } from "./metricAliases.ts";
import type { DomainId, DomainPack } from "./types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

export type SchemaColumn = { originalColumn: string; normalizedColumn: string; canonicalMetric: string | null; status: "MATCHED" | "UNKNOWN" | "AMBIGUOUS"; matchedAlias: string | null; method: "EXACT_CANONICAL" | "EXACT_ALIAS" | "NORMALIZED_ALIAS" | "NONE"; domainId: DomainId | null };
export type DomainResolution = { status: "RESOLVED" | "AMBIGUOUS" | "UNKNOWN"; selectedDomainId?: DomainId; source: "SCHEMA_MATCH" | "MANUAL_OVERRIDE"; candidates: { domainId: DomainId; matchedCanonicalMetrics: string[]; matchedColumns: string[]; strongMatches: string[]; characteristicMatches: string[]; score: number; eligible: boolean }[]; unmatchedColumns: string[] };
/** Schema-match score, not a probability: 2/unique metric + 5/strong + 3/characteristic + 1/outcome. */
export function resolveDatasetSchema(columns: readonly string[], options: { domainId?: string; packs?: readonly DomainPack[] } = {}) {
  const packs = options.packs ?? listDomainPacks();
  const candidates = packs.filter(p => p.detection && p.metrics).map(pack => {
    const matches = columns.flatMap(column => { const match = lookupMetricAlias(pack, column); return match ? [{ column, metric: match.canonicalMetric }] : []; });
    const metrics = [...new Set(matches.map(m => m.metric))].sort();
    const hints = pack.detection!;
    const strongMatches = metrics.filter(m => hints.strongMetrics.includes(m)), characteristicMatches = metrics.filter(m => hints.characteristicMetrics.includes(m));
    const score = metrics.length * 2 + strongMatches.length * 5 + characteristicMatches.length * 3 + metrics.filter(m => pack.outcomeMetrics?.includes(m)).length;
    const eligible = metrics.length >= hints.minimumMatch && (strongMatches.length >= 1 || characteristicMatches.length >= 2) && !metrics.some(m => hints.excludedMetrics?.includes(m));
    return { domainId: pack.id, matchedCanonicalMetrics: metrics, matchedColumns: matches.map(m => m.column), strongMatches, characteristicMatches, score, eligible };
  }).filter(c => c.matchedColumns.length).sort((a, b) => b.score - a.score || a.domainId.localeCompare(b.domainId));
  const automaticWinner = candidates.find(c => c.eligible);
  const runner = candidates.find(c => c.domainId !== automaticWinner?.domainId);
  const margin = packs.find(p => p.id === automaticWinner?.domainId)?.detection?.minimumMargin ?? Infinity;
  const autoStatus = !automaticWinner ? "UNKNOWN" : runner && automaticWinner.score - runner.score < margin ? "AMBIGUOUS" : "RESOLVED";
  const override = options.domainId === undefined ? undefined : packs.find(p => p.id === options.domainId!.trim().toUpperCase());
  const selected = options.domainId !== undefined ? override : autoStatus === "RESOLVED" ? packs.find(p => p.id === automaticWinner?.domainId) : undefined;
  const warnings: string[] = [];
  if (options.domainId !== undefined && !override) warnings.push("Указанный домен не зарегистрирован; mapping не применён.");
  if (override && !candidates.find(c => c.domainId === override.id)?.eligible) warnings.push("Выбранный вручную домен недостаточно поддержан схемой данных. Неизвестные поля не сопоставляются.");
  if (override && autoStatus === "RESOLVED" && automaticWinner?.domainId !== override.id) warnings.push("Выбранный домен отличается от предполагаемого по схеме данных.");
  const mapped: SchemaColumn[] = columns.map(column => {
    const match = selected ? lookupMetricAlias(selected, column) : undefined;
    return { originalColumn: column, normalizedColumn: normalizeMetricAlias(column), canonicalMetric: match?.canonicalMetric ?? null,
      status: match ? "MATCHED" : !selected && autoStatus === "AMBIGUOUS" && packs.some(p => lookupMetricAlias(p, column)) ? "AMBIGUOUS" : "UNKNOWN",
      matchedAlias: match?.matchedAlias ?? null, domainId: selected?.id ?? null,
      method: !match ? "NONE" : column === match.canonicalMetric ? "EXACT_CANONICAL" : column === match.matchedAlias ? "EXACT_ALIAS" : "NORMALIZED_ALIAS" };
  });
  // Two original columns must never silently overwrite the same canonical output field.
  const counts = new Map<string, number>();
  mapped.forEach(c => { if (c.canonicalMetric) counts.set(c.canonicalMetric, (counts.get(c.canonicalMetric) ?? 0) + 1); });
  for (const c of mapped) if (c.canonicalMetric && counts.get(c.canonicalMetric)! > 1) { c.status = "AMBIGUOUS"; c.canonicalMetric = null; }
  if (mapped.some(c => c.status === "AMBIGUOUS") && selected) warnings.push("Несколько исходных колонок соответствуют одной метрике; они сохранены без переименования.");
  const domain: DomainResolution = { status: selected ? "RESOLVED" : options.domainId !== undefined ? "UNKNOWN" : autoStatus, ...(selected ? { selectedDomainId: selected.id } : {}), source: options.domainId !== undefined ? "MANUAL_OVERRIDE" : "SCHEMA_MATCH", candidates, unmatchedColumns: mapped.filter(c => c.status !== "MATCHED").map(c => c.originalColumn) };
  return { domain, columns: mapped, warnings };
}
export type SchemaResolution = ReturnType<typeof resolveDatasetSchema>;
/** Opt-in name normalization only. Dates, values, row order and unknown/context columns are preserved. */
export function normalizeDatasetSchema(dataset: UploadedDataset, schema: SchemaResolution): UploadedDataset {
  if (JSON.stringify(dataset.columns) !== JSON.stringify(schema.columns.map(c => c.originalColumn))) throw new Error("Schema does not bind to these columns.");
  const pack = listDomainPacks().find(p => p.id === schema.domain.selectedDomainId);
  if (schema.columns.some(c => c.status === "MATCHED" && (!pack || lookupMetricAlias(pack, c.originalColumn)?.canonicalMetric !== c.canonicalMetric))) throw new Error("Mapping does not match the registered aliases.");
  const names = schema.columns.map(c => c.status === "MATCHED" ? c.canonicalMetric! : c.originalColumn);
  if (new Set(names).size !== names.length) throw new Error("Normalized output column collision.");
  return { name: dataset.name, columns: names, rows: dataset.rows.map(row => Object.fromEntries(schema.columns.map((c, i) => [names[i], row[c.originalColumn]]))) };
}
