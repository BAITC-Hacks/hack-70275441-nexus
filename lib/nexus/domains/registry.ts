import type { DomainId, DomainPack } from "./types.ts";
import { RETAIL } from "./retail.ts";
import { LOGISTICS } from "./logistics.ts";
import { MANUFACTURING } from "./manufacturing.ts";
import { MINING } from "./mining.ts";
import { buildMetricAliasIndex, normalizeMetricAlias } from "./metricAliases.ts";

export const DOMAIN_PACKS: Readonly<Record<DomainId, DomainPack>> = { RETAIL, LOGISTICS, MANUFACTURING, MINING };
const metricIndexes = new WeakMap<DomainPack, ReturnType<typeof buildMetricAliasIndex>>();
for (const pack of Object.values(DOMAIN_PACKS)) metricIndexes.set(pack, buildMetricAliasIndex(pack));
export function lookupMetricAlias(pack: DomainPack, input: string) {
  try {
    let index = metricIndexes.get(pack);
    if (!index) { index = buildMetricAliasIndex(pack); metricIndexes.set(pack, index); }
    return index.get(normalizeMetricAlias(input));
  } catch { return undefined; } // A caller-supplied invalid pack fails closed; initialization still throws.
}
export function getDomainPack(id: DomainId): DomainPack;
export function getDomainPack(id: string): DomainPack | undefined;
export function getDomainPack(id: string): DomainPack | undefined {
  const key = id.trim().toUpperCase();
  return Object.hasOwn(DOMAIN_PACKS, key) ? DOMAIN_PACKS[key as DomainId] : undefined;
}
export function listDomainPacks(): readonly DomainPack[] { return Object.values(DOMAIN_PACKS); }
/** Exact canonical metric lookup; aliases do not authorize production mappings. */
export function getMetricDefinition(domainId: string, metric: string) {
  const metrics = getDomainPack(domainId)?.metrics;
  return metrics && Object.hasOwn(metrics, metric) ? metrics[metric] : undefined;
}
/** Narrow metadata lookup only: trim/case-insensitive registered names, no fuzzy/prefix matching.
 * The existing structural/semantic column resolvers remain independent and unchanged.
 * Collisions fail closed instead of selecting an arbitrary metric.
 */
export function resolveMetricAlias(domainId: string, input: string): string | undefined {
  const pack = getDomainPack(domainId);
  return pack ? lookupMetricAlias(pack, input)?.canonicalMetric : undefined;
}
export function getDomainConcept(id: DomainId, canonicalId: string) {
  return DOMAIN_PACKS[id].concepts.find(concept => concept.canonicalId === canonicalId);
}
