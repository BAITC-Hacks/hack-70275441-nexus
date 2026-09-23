import { getDomainPack } from "./registry.ts";
import type { DomainId } from "./types.ts";
export { resolveDatasetSchema, normalizeDatasetSchema } from "./schemaResolution.ts";
export type { SchemaResolution, DomainResolution } from "./schemaResolution.ts";

export type ResolutionDomain = DomainId | "UNKNOWN";
export type ResolutionMethod = "EXACT_CANONICAL" | "EXACT_ALIAS" | "NORMALIZED_ALIAS" | "PREFIX_ALIAS" | "AMBIGUOUS" | "UNRESOLVED";
export type ColumnResolution = { column: string; normalized: string; method: ResolutionMethod; canonicalId: string | null; candidates: string[]; domain: ResolutionDomain };
export type DatasetResolution = { domain: ResolutionDomain; columns: ColumnResolution[] };

/** Resolver-local vocabulary normalization. Deliberately independent of routing's normalizeHeaderName. */
function normalize(column: string): string {
  return column.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/[\p{Dash_Punctuation}−_]+/gu, " ").replace(/[(),.%/;:«»"№']/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveColumn(column: string, domain: ResolutionDomain): ColumnResolution {
  const normalized = normalize(column);
  const empty: ColumnResolution = { column, normalized, method: "UNRESOLVED", canonicalId: null, candidates: [], domain };
  if (domain === "UNKNOWN" || !normalized || ["срок", "score", "id", "сумма", "дата", "тип", "значение"].includes(normalized)) return empty;
  const concepts = getDomainPack(domain).concepts;
  const stages: Exclude<ResolutionMethod, "AMBIGUOUS" | "UNRESOLVED">[] = ["EXACT_CANONICAL", "EXACT_ALIAS", "NORMALIZED_ALIAS", "PREFIX_ALIAS"];
  for (const method of stages) {
    const matches: { id: string; length: number }[] = [];
    for (const concept of concepts) {
      if (method === "EXACT_CANONICAL") {
        if (column === concept.canonicalId) matches.push({ id: concept.canonicalId, length: column.length });
        continue;
      }
      if (concept.exactOnly && method !== "EXACT_ALIAS") continue;
      for (const alias of concept.aliases) {
        const key = normalize(alias);
        const matched = method === "EXACT_ALIAS" ? column === alias : method === "NORMALIZED_ALIAS" ? normalized === key : key.length >= 6 && normalized.startsWith(`${key} `);
        if (key && matched) matches.push({ id: concept.canonicalId, length: key.length });
      }
    }
    if (matches.length) {
      const longest = Math.max(...matches.map(match => match.length));
      const candidates = [...new Set(matches.filter(match => match.length === longest).map(match => match.id))].sort();
      return { ...empty, method: candidates.length === 1 ? method : "AMBIGUOUS", canonicalId: candidates.length === 1 ? candidates[0] : null, candidates };
    }
  }
  return empty;
}

export function resolveDatasetColumns(columns: readonly string[], domain: ResolutionDomain): DatasetResolution {
  return { domain, columns: columns.map(column => resolveColumn(column, domain)) };
}
