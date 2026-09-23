import type { UploadedDataset } from "@/lib/nexus/ingestion/types";

export function syntheticIndustrialDataset(): UploadedDataset {
  const rows = Array.from({ length: 72 }, (_, index) => {
    const phase = index > 57 ? (index - 57) * 0.68 : 0;
    return {
      timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      machine_id: `M-${(index % 3) + 1}`,
      temperature: +(66 + Math.sin(index / 4) * 2 + phase).toFixed(2),
      pressure: +(8.2 + Math.sin(index / 5) * 0.4 + phase * 0.08).toFixed(2),
      vibration_rms: +(2.1 + Math.sin(index / 3) * 0.2 + phase * 0.22).toFixed(2),
      motor_current: +(15.1 + Math.sin(index / 7) * 0.6 + phase * 0.3).toFixed(2),
      flow_rate: +(120 - Math.sin(index / 5) * 4 - phase * 1.2).toFixed(2),
      failure_flag: index > 66 ? "watch" : "normal",
    };
  });

  return {
    name: "synthetic_industrial_telemetry.csv",
    columns: Object.keys(rows[0]),
    rows,
  };
}
