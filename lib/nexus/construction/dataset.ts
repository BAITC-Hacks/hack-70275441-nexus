import type { UploadedDataset } from "@/lib/nexus/ingestion/types";

export type ConstructionPoint = {
  date: string;
  planned_progress: number;
  actual_progress: number;
  schedule_gap_pp: number;
  usd_kzt: number;
  estimate_material_price: number;
  actual_material_price: number;
  planned_material_qty: number;
  ordered_material_qty: number;
  planned_delivery_qty: number;
  actual_delivery_qty: number;
  budget_available: number;
  procurement_required: number;
  workers: number;
  contractor_productivity: number;
  weather_disruption_hours: number;
};

/** Synthetic ЖК Alatau weekly construction telemetry — the single shared dataset for both the fixed narrative dashboard and the live agentic construction domain. */
export function buildConstructionRows(): ConstructionPoint[] {
  return Array.from({ length: 24 }, (_, i) => {
    const p = i < 8 ? 0 : i < 12 ? (i - 7) * 1.8 : (i - 7) * 2.1;
    const stable = i < 8;
    const planned_progress = +((i + 1) * 3.8).toFixed(1);
    const actual_progress = +((i + 1) * 3.8 - (stable ? 0.4 + i * 0.05 : p * 1.45)).toFixed(1);
    return {
      date: `2026-W${String(i + 1).padStart(2, "0")}`,
      planned_progress,
      actual_progress,
      schedule_gap_pp: +(planned_progress - actual_progress).toFixed(1),
      usd_kzt: +(472 + (i < 8 ? i * 0.35 : (i - 7) * 5.8) + Math.sin(i) * 1.7).toFixed(1),
      estimate_material_price: 100,
      actual_material_price: +(100 + (i < 10 ? i * 0.12 : (i - 9) * 2.8) + Math.cos(i) * 0.6).toFixed(1),
      planned_material_qty: 1000,
      ordered_material_qty: Math.round(1000 - (i < 13 ? i * 2 : (i - 12) * 35)),
      planned_delivery_qty: 950,
      actual_delivery_qty: Math.round(950 - (i < 15 ? i * 2 : (i - 14) * 42)),
      budget_available: 1200000,
      procurement_required: Math.round(980000 + (i < 11 ? i * 2500 : (i - 10) * 43000)),
      workers: 118 + (i % 4) - 2,
      contractor_productivity: +(0.92 + Math.sin(i) * 0.018).toFixed(2),
      weather_disruption_hours: i % 5 === 0 ? 9 : 3,
    };
  });
}

export function syntheticConstructionDataset(): UploadedDataset {
  const rows = buildConstructionRows();
  return {
    name: "zhk_alatau_construction_telemetry.csv",
    columns: Object.keys(rows[0]),
    rows,
  };
}
