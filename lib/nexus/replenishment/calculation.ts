import type {
  InboundShipment,
  MinimumOrderQuantity,
  MonthlyOpeningStock,
  MonthlySales,
  SalesTransaction,
  YearMonth,
} from "./types.ts";

export interface SkuPlanningConfig {
  sku: string;
  supplier: string;
  category: string;
  /** Partner/planner forecast expressed as a decimal rate: 0.10 means +10%. */
  forecastGrowthRate: number;
  leadTimeMonths?: number;
}

export interface ReplenishmentOptions {
  asOfMonth: YearMonth;
  /** Required fallback: never hidden as a hard-coded lead time. */
  defaultLeadTimeMonths: number;
  reviewPeriodMonths: number;
  /** Category -> safety-stock coverage in months. */
  categorySafetyStockMonths: Record<string, number>;
  trendWindowMonths?: number;
  maxAbsoluteHistoricalGrowthRate?: number;
  stockoutOpeningStockThreshold?: number;
  stockoutNeighborDemandMinimum?: number;
}

export interface ReplenishmentInput {
  monthlySales: MonthlySales[];
  openingStocks: MonthlyOpeningStock[];
  inboundShipments: InboundShipment[];
  salesTransactions: SalesTransaction[];
  skuConfigs: SkuPlanningConfig[];
  minimumOrderQuantities?: MinimumOrderQuantity[];
  options: ReplenishmentOptions;
}

export type ReplenishmentUrgency = "high" | "medium" | "low";

export interface ReplenishmentRecommendation {
  sku: string;
  productName: string;
  supplier: string;
  category: string;
  baseMonthlyDemand: number;
  rawMonthlyDemand: number;
  seasonalIndex: number;
  historicalGrowthRate: number;
  forecastGrowthRate: number;
  combinedGrowthFactor: number;
  adjustedDemandRate: number;
  stockoutAdjustmentUnitsPerMonth: number;
  stockoutCompensationFactor: number;
  stockoutMonths: YearMonth[];
  excludedSpikeCount: number;
  excludedSpikeUnits: number;
  excludedSpikeTransactionIds: string[];
  currentStock: number;
  goodsInTransitWithinHorizon: number;
  leadTimeMonths: number;
  reviewPeriodMonths: number;
  safetyStockMonths: number;
  safetyStock: number;
  targetPosition: number;
  currentPosition: number;
  recommendedOrderBeforeMoq: number;
  moqMultiple: number | null;
  recommendedOrder: number;
  coverageMonths: number | null;
  urgency: ReplenishmentUrgency;
}

export interface SupplierReplenishmentGroup {
  supplier: string;
  items: ReplenishmentRecommendation[];
  totalRecommendedUnits: number;
}

export interface ReplenishmentPlan {
  asOfMonth: YearMonth;
  suppliers: SupplierReplenishmentGroup[];
}

const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value: number): number => Number(value.toFixed(6));

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function spikeThreshold(transactions: SalesTransaction[]): number {
  const values = transactions.map((item) => item.unitsSold).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
  // Both robust rules are considered, with a 3x-median floor preventing zero-MAD series from
  // classifying ordinary small variation as a one-off order.
  return Math.max(center * 3, center + 3 * 1.4826 * mad, q3 + 1.5 * (q3 - q1));
}

function monthOfDate(isoDate: string): YearMonth | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})/);
  return match ? `${+match[1]}-${match[2]}` as YearMonth : null;
}

function addMonths(month: YearMonth, delta: number): YearMonth {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` as YearMonth;
}

function endOfMonth(month: YearMonth): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber, 1) - 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateInput(input: ReplenishmentInput): void {
  const { options } = input;
  if (!(options.defaultLeadTimeMonths > 0)) throw new Error("defaultLeadTimeMonths must be greater than zero.");
  if (!(options.reviewPeriodMonths >= 0)) throw new Error("reviewPeriodMonths cannot be negative.");
  if (new Set(input.skuConfigs.map((item) => item.sku)).size !== input.skuConfigs.length) throw new Error("skuConfigs must contain unique SKU values.");
  for (const config of input.skuConfigs) {
    if (!config.sku || !config.supplier || !config.category) throw new Error("Every SKU config requires sku, supplier and category.");
    if (!Number.isFinite(config.forecastGrowthRate) || config.forecastGrowthRate <= -1) throw new Error(`Invalid forecastGrowthRate for ${config.sku}.`);
    if (config.leadTimeMonths !== undefined && config.leadTimeMonths <= 0) throw new Error(`Invalid leadTimeMonths for ${config.sku}.`);
    const safetyMonths = options.categorySafetyStockMonths[config.category];
    if (!Number.isFinite(safetyMonths) || safetyMonths < 0) throw new Error(`Missing category safety-stock policy for ${config.category}.`);
  }
}

function recommendationForSku(input: ReplenishmentInput, config: SkuPlanningConfig): ReplenishmentRecommendation {
  const { options } = input;
  const sales = input.monthlySales.filter((item) => item.sku === config.sku && item.month <= options.asOfMonth).sort((a, b) => a.month.localeCompare(b.month));
  if (!sales.length) throw new Error(`No monthly sales found for ${config.sku}.`);
  const transactions = input.salesTransactions.filter((item) => item.sku === config.sku);
  const threshold = spikeThreshold(transactions);
  const spikes = transactions.filter((item) => item.unitsSold > threshold);
  const spikeUnitsByMonth = new Map<YearMonth, number>();
  for (const spike of spikes) {
    const month = monthOfDate(spike.occurredAt);
    if (month) spikeUnitsByMonth.set(month, (spikeUnitsByMonth.get(month) ?? 0) + spike.unitsSold);
  }
  const cleaned = sales.map((item) => ({ ...item, unitsSold: Math.max(0, item.unitsSold - (spikeUnitsByMonth.get(item.month) ?? 0)) }));
  const stockByMonth = new Map(input.openingStocks.filter((item) => item.sku === config.sku).map((item) => [item.month, item.openingStock]));
  const stockoutThreshold = options.stockoutOpeningStockThreshold ?? 0;
  const neighborMinimum = options.stockoutNeighborDemandMinimum ?? 1;
  const stockoutMonths = cleaned.flatMap((item, index) => {
    const stock = stockByMonth.get(item.month);
    const previous = cleaned[index - 1]?.unitsSold;
    const next = cleaned[index + 1]?.unitsSold;
    return stock !== undefined && stock <= stockoutThreshold && previous >= neighborMinimum && next >= neighborMinimum ? [item.month] : [];
  });
  const stockoutSet = new Set(stockoutMonths);
  const demandWithoutStockouts = cleaned.filter((item) => !stockoutSet.has(item.month));
  const rawMonthlyDemand = average(cleaned.map((item) => item.unitsSold));
  const baseMonthlyDemand = average(demandWithoutStockouts.map((item) => item.unitsSold));

  const calendarMonth = Number(options.asOfMonth.slice(5, 7));
  const sameCalendarMonth = demandWithoutStockouts.filter((item) => Number(item.month.slice(5, 7)) === calendarMonth);
  const seasonalIndex = baseMonthlyDemand > 0 && sameCalendarMonth.length
    ? average(sameCalendarMonth.map((item) => item.unitsSold)) / baseMonthlyDemand
    : 1;

  const window = Math.max(1, options.trendWindowMonths ?? 3);
  const recent = demandWithoutStockouts.slice(-window).map((item) => item.unitsSold);
  const earlier = demandWithoutStockouts.slice(-window * 2, -window).map((item) => item.unitsSold);
  const earlierAverage = average(earlier), recentAverage = average(recent);
  const rawHistoricalGrowth = earlierAverage > 0 && earlier.length ? recentAverage / earlierAverage - 1 : 0;
  const growthLimit = options.maxAbsoluteHistoricalGrowthRate ?? 0.5;
  const historicalGrowthRate = clamp(rawHistoricalGrowth, -growthLimit, growthLimit);
  const combinedGrowthFactor = (1 + historicalGrowthRate) * (1 + config.forecastGrowthRate);
  // `baseMonthlyDemand` is already stockout-compensated (stockout months are excluded from its average,
  // not counted as zero demand). `stockoutCompensationFactor` is kept only as an audit/narration figure —
  // "how much higher the corrected demand is than the naive raw average" — and must NOT be multiplied into
  // the rate again, or the compensation is effectively applied twice (once by exclusion, once by this
  // factor), inflating the recommendation beyond what the data supports.
  const stockoutCompensationFactor = rawMonthlyDemand > 0 ? Math.max(1, baseMonthlyDemand / rawMonthlyDemand) : 1;
  const adjustedDemandRate = baseMonthlyDemand * seasonalIndex * combinedGrowthFactor;

  const stockRows = input.openingStocks.filter((item) => item.sku === config.sku && item.month <= options.asOfMonth).sort((a, b) => a.month.localeCompare(b.month));
  const currentStock = stockRows.at(-1)?.openingStock ?? 0;
  const leadTimeMonths = config.leadTimeMonths ?? options.defaultLeadTimeMonths;
  const horizonMonths = leadTimeMonths + options.reviewPeriodMonths;
  const horizonEnd = endOfMonth(addMonths(options.asOfMonth, Math.ceil(horizonMonths)));
  const goodsInTransitWithinHorizon = input.inboundShipments
    .filter((item) => item.sku === config.sku && (item.expectedDate === null || Date.parse(item.expectedDate) <= horizonEnd))
    .reduce((sum, item) => sum + item.quantity, 0);
  const safetyStockMonths = options.categorySafetyStockMonths[config.category];
  const safetyStock = adjustedDemandRate * safetyStockMonths;

  /**
   * Deterministic replenishment formula from the case specification:
   * target_position = cleaned_seasonal_growth_adjusted_demand_rate
   *   * (lead_time_months + review_period_months) + safety_stock
   * current_position = current_stock + goods_in_transit_within_horizon
   * recommended_order = max(0, target_position - current_position)
   */
  const targetPosition = adjustedDemandRate * horizonMonths + safetyStock;
  const currentPosition = currentStock + goodsInTransitWithinHorizon;
  const recommendedOrderBeforeMoq = Math.max(0, targetPosition - currentPosition);
  const moqMultiple = input.minimumOrderQuantities?.find((item) => item.sku === config.sku)?.multiple ?? null;
  const recommendedOrder = moqMultiple && recommendedOrderBeforeMoq > 0
    ? Math.ceil(recommendedOrderBeforeMoq / moqMultiple) * moqMultiple
    : recommendedOrderBeforeMoq;
  const coverageMonths = adjustedDemandRate > 0 ? currentPosition / adjustedDemandRate : null;
  const urgency: ReplenishmentUrgency = coverageMonths !== null && coverageMonths < leadTimeMonths
    ? "high"
    : coverageMonths !== null && coverageMonths < horizonMonths ? "medium" : "low";

  return {
    sku: config.sku,
    productName: sales.at(-1)?.productName ?? config.sku,
    supplier: config.supplier,
    category: config.category,
    baseMonthlyDemand: round(baseMonthlyDemand),
    rawMonthlyDemand: round(rawMonthlyDemand),
    seasonalIndex: round(seasonalIndex),
    historicalGrowthRate: round(historicalGrowthRate),
    forecastGrowthRate: round(config.forecastGrowthRate),
    combinedGrowthFactor: round(combinedGrowthFactor),
    adjustedDemandRate: round(adjustedDemandRate),
    stockoutAdjustmentUnitsPerMonth: round(baseMonthlyDemand - rawMonthlyDemand),
    stockoutCompensationFactor: round(stockoutCompensationFactor),
    stockoutMonths,
    excludedSpikeCount: spikes.length,
    excludedSpikeUnits: round(spikes.reduce((sum, item) => sum + item.unitsSold, 0)),
    excludedSpikeTransactionIds: spikes.map((item) => item.invoiceNumber),
    currentStock: round(currentStock),
    goodsInTransitWithinHorizon: round(goodsInTransitWithinHorizon),
    leadTimeMonths: round(leadTimeMonths),
    reviewPeriodMonths: round(options.reviewPeriodMonths),
    safetyStockMonths: round(safetyStockMonths),
    safetyStock: round(safetyStock),
    targetPosition: round(targetPosition),
    currentPosition: round(currentPosition),
    recommendedOrderBeforeMoq: round(recommendedOrderBeforeMoq),
    moqMultiple,
    recommendedOrder: round(recommendedOrder),
    coverageMonths: coverageMonths === null ? null : round(coverageMonths),
    urgency,
  };
}

export function calculateReplenishment(input: ReplenishmentInput): ReplenishmentPlan {
  validateInput(input);
  const recommendations = input.skuConfigs.map((config) => recommendationForSku(input, config));
  const suppliers = [...new Set(recommendations.map((item) => item.supplier))].sort().map((supplier) => {
    const items = recommendations.filter((item) => item.supplier === supplier).sort((a, b) => a.sku.localeCompare(b.sku));
    return { supplier, items, totalRecommendedUnits: round(items.reduce((sum, item) => sum + item.recommendedOrder, 0)) };
  });
  return { asOfMonth: input.options.asOfMonth, suppliers };
}
