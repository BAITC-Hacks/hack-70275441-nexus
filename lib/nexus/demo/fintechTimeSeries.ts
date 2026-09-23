import type { UploadedDataset } from "../ingestion/types.ts";

const WEEK_MS = 7 * 86_400_000;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/**
 * Deterministic synthetic credit-portfolio pressure. The irregular cycles make
 * shifted relationships observable without turning every business series into
 * the same monotonic curve.
 */
function fundingPressure(index: number) {
  if (index < 0) return 0;
  const baseline = 0.18 * Math.sin(index * 1.17) + 0.09 * Math.cos(index * 0.43);
  if (index < 18) return baseline;
  if (index < 34) return 0.45 + (index - 18) * 0.18 + baseline + 0.32 * Math.sin((index - 18) * 0.79);
  if (index < 45) return 3.25 + (index - 34) * 0.16 + baseline + 0.42 * Math.sin((index - 34) * 0.93);
  return 4.9 + (index - 45) * 0.11 + baseline + 0.5 * Math.sin((index - 45) * 0.71);
}

/** Registry-aligned 52-week FinTech demonstration dataset; no random state. */
export function fintechTimeSeriesDataset(): UploadedDataset {
  const rows = Array.from({ length: 52 }, (_, index) => {
    const pressure = fundingPressure(index);
    const delinquencyPressure = fundingPressure(index - 1);
    const defaultPressure = fundingPressure(index - 3);
    const revenue = 1_280_000_000 + index * 1_800_000 + 24_000_000 * Math.sin(index * 0.57) + 9_000_000 * Math.cos(index * 1.31);
    const operatingCost = 910_000_000 + index * 1_250_000 + 17_000_000 * Math.cos(index * 0.49) + fundingPressure(index - 2) * 3_200_000;

    return {
      date: new Date(Date.UTC(2025, 0, 6) + index * WEEK_MS).toISOString(),
      cost_of_funds: round(6.35 + pressure * 0.22 + 0.035 * Math.sin(index * 1.83), 3),
      delinquency_rate: round(2.05 + delinquencyPressure * 0.19 + 0.045 * Math.cos(index * 1.29), 3),
      capital_adequacy_ratio: round(15.4 + 0.18 * Math.sin(index * 0.61) - 0.07 * Math.cos(index * 1.47), 3),
      loan_portfolio: Math.round(8_400_000_000 + index * 19_000_000 + 62_000_000 * Math.sin(index * 0.38)),
      revenue: Math.round(revenue),
      profit: Math.round(revenue - operatingCost),
      default_rate: round(1.12 + defaultPressure * 0.155 + 0.04 * Math.sin(index * 1.11), 3),
    };
  });

  return {
    name: "synthetic_fintech_52_weeks.xlsx",
    columns: Object.keys(rows[0]),
    rows,
  };
}
