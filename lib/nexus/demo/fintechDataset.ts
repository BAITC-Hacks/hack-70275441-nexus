import fintechDemo from "../../../data/fintech_demo.json" with { type: "json" };
import type { CellValue, UploadedDataset } from "@/lib/nexus/ingestion/types";

/**
 * The same hand-authored 24-month FinTech series the archived fixed dashboard uses, exposed as an ordinary
 * dataset so the financial demo runs through the one live investigation path instead of a separate page.
 * Synthetic demonstration data — not real portfolio data from any institution.
 */
export function fintechDemoDataset(): UploadedDataset {
  const indicators = fintechDemo.indicators as Record<string, number[]>;
  const names = Object.keys(indicators);
  const rows: Record<string, CellValue>[] = fintechDemo.periods.map((period, index) => ({
    month: period,
    ...Object.fromEntries(names.map((name) => [name, indicators[name][index]])),
  }));
  return { name: "portfolio_risk_monitor.csv", columns: ["month", ...names], rows };
}
