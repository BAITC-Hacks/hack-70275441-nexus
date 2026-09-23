import type { UploadedDataset } from "../ingestion/types.ts";
import { bankFixtureMetadata } from "../universal/fixtures.ts";
import type { CrossSectionalFixtureMetadata } from "./types.ts";

const expectedBankRiskScore = (row: UploadedDataset["rows"][number]) =>
  Math.round((10 + Number(row.DTI) * 30 + Number(row.delinquencies_12m) * 7 + Number(row.current_delinquency) * 10 + (700 - Number(row.credit_rating)) * 0.1) * 10) / 10;

/** Provenance is attached only when every supplied score satisfies the prepared fixture's published formula. */
export function fixtureMetadataFor(dataset: UploadedDataset): CrossSectionalFixtureMetadata | undefined {
  const required = ["DTI", "delinquencies_12m", "current_delinquency", "credit_rating", "risk_score"];
  if (dataset.name !== bankFixtureMetadata.datasetName || !required.every((column) => dataset.columns.includes(column))) return undefined;
  if (!dataset.rows.every((row) => required.every((column) => Number.isFinite(Number(row[column]))) && Number(row.risk_score) === expectedBankRiskScore(row))) return undefined;
  return bankFixtureMetadata;
}
