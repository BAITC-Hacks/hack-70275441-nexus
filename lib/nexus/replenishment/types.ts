export type YearMonth = `${number}-${string}`;

export interface SalesTransaction {
  occurredAt: string;
  invoiceNumber: string;
  document?: string;
  sku: string;
  productName: string;
  unit?: string;
  warehouse?: string;
  /** Absolute quantity sold. The source journal stores sales as negative quantities. */
  unitsSold: number;
  /** Original signed value retained for auditability. */
  sourceQuantity: number;
}

export interface MonthlySales {
  sku: string;
  productName: string;
  unit?: string;
  month: YearMonth;
  unitsSold: number;
}

export interface MonthlyOpeningStock {
  sku: string;
  productName: string;
  unit?: string;
  month: YearMonth;
  openingStock: number;
}

export interface InboundShipment {
  sku: string;
  supplierArticle?: string;
  productName: string;
  /** Original supply-column label, used as a stable, auditable shipment identifier. */
  shipmentId: string;
  /** Present only when the column explicitly states a full expected-arrival date. */
  expectedDate: string | null;
  quantity: number;
}

export interface MinimumOrderQuantity {
  sku: string;
  supplierArticle?: string;
  productName: string;
  /** Smallest permitted order multiple. */
  multiple: number;
}

export type XlsxInput = ArrayBuffer | Uint8Array;
