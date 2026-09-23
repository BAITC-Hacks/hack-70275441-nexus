import type { ReplenishmentInput, ReplenishmentOptions, SkuPlanningConfig } from "./calculation.ts";
import type { InboundShipment, MinimumOrderQuantity, MonthlyOpeningStock, MonthlySales, SalesTransaction, SkuCategory, SkuReservation, YearMonth } from "./types.ts";

export interface SupplierParsedData {
  supplier: string;
  monthlySales: MonthlySales[];
  openingStocks: MonthlyOpeningStock[];
  inboundShipments: InboundShipment[];
  salesTransactions: SalesTransaction[];
  minimumOrderQuantities: MinimumOrderQuantity[];
  categories?: SkuCategory[];
  reservations?: SkuReservation[];
}

export interface AssemblyAssumptions {
  defaultLeadTimeMonths: number;
  reviewPeriodMonths: number;
  categoryServiceLevel: Record<string, number>;
  /** Used only where the partner file has no SKU category (currently IEK). */
  defaultCategory: string;
  /** External forecast remains independent from the historical trend calculated later. */
  defaultForecastGrowthRate: number;
  forecastGrowthBySku?: Record<string, number>;
  leadTimeBySku?: Record<string, number>;
}

export const DEFAULT_ASSEMBLY_ASSUMPTIONS: AssemblyAssumptions = {
  // No authoritative lead-time/review SLA was supplied in the workbooks. These explicit, UI-replaceable
  // planning assumptions are deliberately kept outside calculateReplenishment.
  defaultLeadTimeMonths: 2,
  reviewPeriodMonths: 1,
  defaultCategory: "UNCLASSIFIED",
  defaultForecastGrowthRate: 0,
  // Engineering assumptions until partner-provided service targets exist: top category 98%, middle 95%,
  // lower categories 90%; IEK's unclassified fallback uses the neutral 95% target.
  categoryServiceLevel: { "1": 0.98, "2": 0.95, "3": 0.9, "4": 0.9, A: 0.98, B: 0.95, C: 0.9, UNCLASSIFIED: 0.95 },
};

function latestMonth(rows: MonthlyOpeningStock[]): YearMonth {
  const months = rows.map((row) => row.month).sort();
  if (!months.length) throw new Error("Невозможно определить расчётный месяц: данные об остатках отсутствуют.");
  return months.at(-1)!;
}

export function assembleReplenishmentInput(suppliers: SupplierParsedData[], assumptions: AssemblyAssumptions = DEFAULT_ASSEMBLY_ASSUMPTIONS): ReplenishmentInput {
  if (!suppliers.length) throw new Error("Не переданы данные поставщиков.");
  const monthlySales = suppliers.flatMap((data) => data.monthlySales);
  const openingStocks = suppliers.flatMap((data) => data.openingStocks);
  const inboundShipments = suppliers.flatMap((data) => data.inboundShipments);
  const salesTransactions = suppliers.flatMap((data) => data.salesTransactions);
  const minimumOrderQuantities = suppliers.flatMap((data) => data.minimumOrderQuantities);
  const reservations = suppliers.flatMap((data) => data.reservations ?? []);
  const skuConfigs: SkuPlanningConfig[] = suppliers.flatMap((data) => {
    const categoryBySku = new Map(data.categories?.map((item) => [item.sku, item.category]));
    return [...new Set(data.monthlySales.map((item) => item.sku))].map((sku) => ({
      sku,
      supplier: data.supplier,
      category: categoryBySku.get(sku) ?? assumptions.defaultCategory,
      forecastGrowthRate: assumptions.forecastGrowthBySku?.[sku] ?? assumptions.defaultForecastGrowthRate,
      ...(assumptions.leadTimeBySku?.[sku] ? { leadTimeMonths: assumptions.leadTimeBySku[sku] } : {}),
    }));
  });
  const categoryServiceLevel = { ...assumptions.categoryServiceLevel };
  for (const config of skuConfigs) if (categoryServiceLevel[config.category] === undefined) categoryServiceLevel[config.category] = categoryServiceLevel[assumptions.defaultCategory] ?? 0.95;
  const options: ReplenishmentOptions = {
    asOfMonth: latestMonth(openingStocks),
    defaultLeadTimeMonths: assumptions.defaultLeadTimeMonths,
    reviewPeriodMonths: assumptions.reviewPeriodMonths,
    categoryServiceLevel,
  };
  return { monthlySales, openingStocks, inboundShipments, salesTransactions, minimumOrderQuantities, reservations, skuConfigs, options };
}
