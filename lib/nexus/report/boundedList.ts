/** Display only: the source list and Evidence are never changed. */
export function formatBoundedIds(ids: readonly (string | number)[]): string {
  const limit = 12;
  const preview = ids.slice(0, limit).join(", ");
  const remaining = Math.max(0, ids.length - limit);
  return `${ids.length} ID${preview ? ` · ${preview}` : ""}${remaining ? ` … (ещё ${remaining})` : ""}`;
}
