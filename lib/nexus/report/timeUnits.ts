import type { UploadedDataset } from "../ingestion/types.ts";

export type PresentationCadence = "weekly" | "monthly" | "unknown";
/** Presentation only. Requires every timestamp in original row order; no sorting or skipped rows. */
export function inferPresentationCadence(dataset: UploadedDataset, dateColumn: string | null): PresentationCadence {
  if (!dateColumn || dataset.rows.length < 3) return "unknown";
  const dates = dataset.rows.map(row => {
    const value = row[dateColumn];
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) ? date : null;
  });
  if (dates.some(d => d === null)) return "unknown";
  const valid = dates as Date[];
  if (valid.slice(1).every((d, i) => d.getTime() - valid[i].getTime() === 7 * 86400000)) return "weekly";
  const endOfMonth = (d: Date) => d.getUTCDate() === new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (valid.slice(1).every((d, i) => {
    const prior = valid[i];
    return d.getUTCFullYear() * 12 + d.getUTCMonth() - (prior.getUTCFullYear() * 12 + prior.getUTCMonth()) === 1
      && d.toISOString().slice(11) === prior.toISOString().slice(11)
      && (d.getUTCDate() === prior.getUTCDate() || (endOfMonth(d) && endOfMonth(prior)));
  })) return "monthly";
  return "unknown";
}

function unit(count: number, cadence: PresentationCadence) {
  const forms = cadence === "weekly" ? ["неделя", "недели", "недель"] : cadence === "monthly" ? ["месяц", "месяца", "месяцев"] : ["период", "периода", "периодов"];
  const n = Math.abs(count), last = n % 10, lastTwo = n % 100;
  return forms[lastTwo >= 11 && lastTwo <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
}
export function formatLag(count: number, cadence: PresentationCadence): string { return `${count} ${unit(count, cadence)}`; }
export function formatLagRange(range: { min?: number; max?: number }, cadence: PresentationCadence): string {
  return `${range.min ?? "—"}–${range.max ?? "—"} ${unit(range.max ?? range.min ?? 0, cadence)}`;
}
