import type { UploadedDataset } from "../ingestion/types.ts";

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
/** Controlled supply pressure with cycles and late partial recovery; no random state. */
function pressure(i: number) {
  if (i < 0) return 10;
  if (i < 20) return 10 + 2 * Math.sin(i * 1.3);
  if (i < 42) return 40 + (i - 20) * 7 + 8 * Math.sin((i - 20) * 0.8);
  return 180 + 12 * Math.sin((i - 42) * 0.7) - (i - 42) * 2;
}

export function constructionTimeSeriesDataset(): UploadedDataset {
  const rows = Array.from({ length: 52 }, (_, i) => {
    const planned = round(2 + i * 1.7);
    const gap = round(0.5 + pressure(i - 3) * 0.035 + 0.12 * Math.sin(i * 1.7));
    // First six numeric fields are the production prepared-demo selection.
    return {
      date: new Date(Date.UTC(2025, 0, 6) + i * 7 * 86400000).toISOString(),
      ordered_material_qty: round(1000 - pressure(i) + 2 * Math.sin(i * 0.91)),
      actual_delivery_qty: round(950 - pressure(i - 1) + 2 * Math.cos(i * 1.1)),
      actual_material_price: round(100 + gap * 1.5 + 0.6 * Math.sin(i * 1.9)),
      procurement_required: Math.round(900000 + pressure(i) * 800 + 1000 * Math.sin(i * 0.9)),
      usd_kzt: round(480 + 3 * Math.sin(i * 1.4) + 1.5 * Math.cos(i * 0.3) + (i === 51 ? 6 : 0)),
      weather_disruption_hours: round(4 + 1.5 * Math.sin(i * 1.2)),
      schedule_gap_pp: gap,
      planned_progress: planned,
      actual_progress: round(planned - gap),
      planned_material_qty: 1000,
      planned_delivery_qty: 950,
      estimate_material_price: 100,
      budget_available: 1000000,
      workers: round(120 + 3 * Math.sin(i * 0.8)),
      contractor_productivity: round(0.92 + 0.015 * Math.sin(i * 0.9), 3),
    };
  });
  return { name: "synthetic_construction_52_weeks.xlsx", columns: Object.keys(rows[0]), rows };
}
