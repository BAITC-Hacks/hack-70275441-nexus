export type CellValue = string | number | boolean | null;

export interface UploadedDataset {
  name: string;
  rows: Record<string, CellValue>[];
  columns: string[];
}

export type ColumnKind = "numeric" | "categorical" | "datetime" | "boolean" | "empty";

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  missing: number;
  missingPercent: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  standardDeviation?: number;
  first?: CellValue;
  latest?: CellValue;
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  dateColumns: string[];
  numericColumns: string[];
  categoricalColumns: string[];
  dateRange?: { first: string; last: string };
  frequency?: string;
  duplicateRows: number;
  invalidDateCount: number;
  constantColumns: string[];
}
