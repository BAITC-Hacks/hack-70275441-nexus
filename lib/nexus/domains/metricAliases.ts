import type { DomainPack } from "./types.ts";
/** Preserves semantic tokens (including % and units); no substring/fuzzy matching. */
export function normalizeMetricAlias(value: string): string {
  return value.normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/ё/g, "е")
    .replace(/[\p{Dash_Punctuation}_/]+/gu, " ").replace(/[(),.;:«»"'!?]+/g, " ").replace(/\s+/g, " ").trim();
}
export function uniqueMetricAliases(canonical: string, aliases: readonly string[]): string[] {
  const seen = new Set([normalizeMetricAlias(canonical)]);
  return aliases.filter(a => { const n = normalizeMetricAlias(a); if (!n || seen.has(n)) return false; seen.add(n); return true; });
}
export function buildMetricAliasIndex(pack: DomainPack): Map<string, { canonicalMetric: string; matchedAlias: string }> {
  const index = new Map<string, { canonicalMetric: string; matchedAlias: string }>();
  for (const [key, metric] of Object.entries(pack.metrics ?? {})) {
    if (key !== metric.canonicalName || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) throw new Error(`Invalid canonical metric: ${pack.id}/${key}`);
    for (const alias of [key, ...(metric.aliases ?? [])]) {
      const normalized = normalizeMetricAlias(alias);
      if (!normalized || index.has(normalized)) throw new Error(`Duplicate normalized metric alias: ${pack.id}/${normalized}`);
      index.set(normalized, { canonicalMetric: key, matchedAlias: alias });
    }
  }
  return index;
}
