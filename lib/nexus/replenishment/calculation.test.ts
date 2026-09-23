import test from "node:test";
import assert from "node:assert/strict";
import { calculateReplenishment, type ReplenishmentInput } from "./calculation.ts";
import type { MonthlyOpeningStock, MonthlySales, SalesTransaction, YearMonth } from "./types.ts";

const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"] as YearMonth[];
const sales = (values: number[], sku = "SKU-1"): MonthlySales[] => values.map((unitsSold, index) => ({ sku, productName: sku, month: months[index], unitsSold }));
const stocks = (values: number[], sku = "SKU-1"): MonthlyOpeningStock[] => values.map((openingStock, index) => ({ sku, productName: sku, month: months[index], openingStock }));
const transaction = (unitsSold: number, index: number, month = "2025-12", sku = "SKU-1"): SalesTransaction => ({
  occurredAt: `${month}-15T10:00:00.000Z`, invoiceNumber: `INV-${index}`, sku, productName: sku,
  unitsSold, sourceQuantity: -unitsSold,
});

function baseInput(): ReplenishmentInput {
  return {
    monthlySales: sales([100, 100, 100, 100, 100, 100]),
    openingStocks: stocks([20, 20, 20, 20, 20, 20]),
    inboundShipments: [],
    salesTransactions: [10, 10, 9, 11, 10].map((value, index) => transaction(value, index)),
    skuConfigs: [{ sku: "SKU-1", supplier: "Supplier A", category: "A", forecastGrowthRate: 0 }],
    minimumOrderQuantities: [],
    options: {
      asOfMonth: "2025-12",
      defaultLeadTimeMonths: 2,
      reviewPeriodMonths: 1,
      categoryServiceLevel: { A: 0.98, B: 0.95, C: 0.9 },
      trendWindowMonths: 3,
    },
  };
}

const first = (input: ReplenishmentInput) => calculateReplenishment(input).suppliers[0].items[0];

test("criterion 1 — changing sales history changes the recommendation", () => {
  const baseline = baseInput();
  const changed = baseInput();
  changed.monthlySales = sales([120, 120, 120, 120, 120, 120]);
  assert.notEqual(first(changed).recommendedOrder, first(baseline).recommendedOrder);
});

test("criterion 1 — changing current stock changes the recommendation", () => {
  const baseline = baseInput();
  const changed = baseInput();
  changed.openingStocks = stocks([20, 20, 20, 20, 20, 80]);
  assert.ok(first(changed).recommendedOrder < first(baseline).recommendedOrder);
});

test("criterion 1 — changing goods in transit changes the recommendation", () => {
  const baseline = baseInput();
  const changed = baseInput();
  changed.inboundShipments = [{ sku: "SKU-1", productName: "SKU-1", shipmentId: "SHIP-1", expectedDate: null, quantity: 70 }];
  assert.ok(first(changed).recommendedOrder < first(baseline).recommendedOrder);
});

test("criterion 1 — changing category changes category safety stock and the recommendation", () => {
  const categoryA = baseInput();
  const categoryB = baseInput();
  categoryA.monthlySales = sales([50, 150, 50, 150, 50, 150]);
  categoryB.monthlySales = sales([50, 150, 50, 150, 50, 150]);
  categoryB.skuConfigs[0] = { ...categoryB.skuConfigs[0], category: "C" };
  assert.ok(first(categoryA).safetyStock > first(categoryB).safetyStock);
  assert.notEqual(first(categoryA).recommendedOrder, first(categoryB).recommendedOrder);
});

test("criterion 1 — changing partner forecast growth changes the recommendation", () => {
  const baseline = baseInput();
  const changed = baseInput();
  changed.skuConfigs[0] = { ...changed.skuConfigs[0], forecastGrowthRate: 0.2 };
  assert.ok(first(changed).recommendedOrder > first(baseline).recommendedOrder);
});

test("criterion 2 — seasonal demand follows the calendar-month pattern instead of a flat average", () => {
  const input = baseInput();
  const seasonalMonths = Array.from({ length: 24 }, (_, index) => `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}` as YearMonth);
  input.monthlySales = seasonalMonths.map((month) => ({ sku: "SKU-1", productName: "SKU-1", month, unitsSold: month.endsWith("-12") ? 300 : 50 }));
  input.openingStocks = seasonalMonths.map((month) => ({ sku: "SKU-1", productName: "SKU-1", month, openingStock: 10 }));
  input.options.asOfMonth = "2025-12";
  input.options.maxAbsoluteHistoricalGrowthRate = 0;
  const result = first(input);
  assert.ok(result.seasonalIndex > 3);
  assert.ok(result.adjustedDemandRate > result.baseMonthlyDemand);
});

test("criterion 3 — inferred stockout excludes constrained demand and corrects need upward", () => {
  const raw = baseInput();
  raw.monthlySales = sales([100, 100, 0, 100, 100, 100]);
  raw.openingStocks = stocks([10, 10, 10, 10, 10, 20]);
  raw.options.maxAbsoluteHistoricalGrowthRate = 0;
  raw.options.categoryServiceLevel = { A: 0.95 };
  raw.options.defaultLeadTimeMonths = 24;
  raw.options.reviewPeriodMonths = 0;
  // asOfMonth is deliberately a calendar month (January) with no prior same-calendar-month history among
  // the 6 recorded months (all Jul-Dec) — this keeps seasonalIndex at its neutral fallback (1) so the
  // comparison below isolates the stockout-compensation effect on baseMonthlyDemand/adjustedDemandRate
  // instead of being masked by baseMonthlyDemand canceling out algebraically against a same-month seasonal
  // ratio (adjustedDemandRate = baseMonthlyDemand * (avg(sameMonth) / baseMonthlyDemand) = avg(sameMonth),
  // which is independent of baseMonthlyDemand whenever a same-calendar-month data point exists).
  raw.options.asOfMonth = "2026-01";
  const constrained = structuredClone(raw);
  constrained.openingStocks[2].openingStock = 0;
  const rawResult = first(raw), corrected = first(constrained);
  assert.deepEqual(corrected.stockoutMonths, ["2025-09"]);
  assert.ok(corrected.baseMonthlyDemand > corrected.rawMonthlyDemand);
  assert.ok(corrected.adjustedDemandRate > rawResult.adjustedDemandRate);
  assert.ok(corrected.recommendedOrder > rawResult.recommendedOrder);
});

test("criterion 4 — a one-off large transaction is excluded from regular demand", () => {
  const baseline = baseInput();
  baseline.openingStocks = stocks([10, 10, 10, 10, 10, 0]);
  baseline.options.maxAbsoluteHistoricalGrowthRate = 0;
  baseline.options.categoryServiceLevel = { A: 0.95 };
  baseline.options.defaultLeadTimeMonths = 1;
  baseline.options.reviewPeriodMonths = 0;
  const withSpike = structuredClone(baseline);
  withSpike.monthlySales[5].unitsSold += 1000;
  withSpike.salesTransactions.push(transaction(1000, 99));
  const regular = first(baseline), cleaned = first(withSpike);
  assert.equal(cleaned.excludedSpikeCount, 1);
  assert.equal(cleaned.excludedSpikeUnits, 1000);
  assert.equal(cleaned.recommendedOrder, regular.recommendedOrder);
});

test("criterion 5 — results are grouped by supplier and expose urgency and every explanation field", () => {
  const input = baseInput();
  input.monthlySales.push(...sales([50, 50, 50, 50, 50, 50], "SKU-2"));
  input.openingStocks.push(...stocks([200, 200, 200, 200, 200, 200], "SKU-2"));
  input.skuConfigs.push({ sku: "SKU-2", supplier: "Supplier B", category: "B", forecastGrowthRate: 0.05, leadTimeMonths: 1 });
  input.minimumOrderQuantities = [{ sku: "SKU-1", productName: "SKU-1", multiple: 25 }];
  const plan = calculateReplenishment(input);
  assert.deepEqual(plan.suppliers.map((group) => group.supplier), ["Supplier A", "Supplier B"]);
  const urgent = plan.suppliers[0].items[0];
  assert.equal(urgent.urgency, "high");
  assert.equal(urgent.recommendedOrder % 25, 0);
  for (const key of ["baseMonthlyDemand", "seasonalIndex", "historicalGrowthRate", "forecastGrowthRate", "stockoutAdjustmentUnitsPerMonth", "currentStock", "reservedStock", "availableStock", "goodsInTransitWithinHorizon", "excludedSpikeUnits", "demandStdDev", "serviceLevel", "safetyStockZScore"] as const) {
    assert.equal(typeof urgent[key], "number", `${key} must be exposed`);
  }
  assert.equal(plan.suppliers[1].items[0].urgency, "low");
});

test("volatile demand receives more safety stock than stable demand with the same mean and service level", () => {
  const stable = baseInput(), volatile = baseInput();
  volatile.monthlySales = sales([50, 150, 50, 150, 50, 150]);
  const stableResult = first(stable), volatileResult = first(volatile);
  assert.equal(stableResult.baseMonthlyDemand, volatileResult.baseMonthlyDemand);
  assert.ok(volatileResult.demandStdDev > stableResult.demandStdDev);
  assert.ok(volatileResult.safetyStock > stableResult.safetyStock);
});

test("higher category service level produces more safety stock at equal volatility", () => {
  const high = baseInput(), low = baseInput();
  high.monthlySales = sales([50, 150, 50, 150, 50, 150]);
  low.monthlySales = sales([50, 150, 50, 150, 50, 150]);
  low.skuConfigs[0] = { ...low.skuConfigs[0], category: "C" };
  assert.ok(first(high).safetyStockZScore > first(low).safetyStockZScore);
  assert.ok(first(high).safetyStock > first(low).safetyStock);
});

test("reserved customer stock reduces availability and increases the recommended order", () => {
  const withoutReservation = baseInput(), withReservation = baseInput();
  withReservation.reservations = [{ sku: "SKU-1", reservedStock: 15 }];
  const baseline = first(withoutReservation), reserved = first(withReservation);
  assert.equal(reserved.availableStock, 5);
  assert.equal(reserved.currentPosition, baseline.currentPosition - 15);
  assert.ok(reserved.recommendedOrder > baseline.recommendedOrder);
});

test("repeated recent large transactions are retained as a sustained growth signal", () => {
  const input = baseInput();
  input.monthlySales[4].unitsSold += 500;
  input.monthlySales[5].unitsSold += 500;
  input.salesTransactions.push(transaction(500, 90, "2025-11"), transaction(500, 91, "2025-12"));
  const result = first(input);
  assert.equal(result.excludedSpikeCount, 0);
  assert.equal(result.retainedGrowthSpikeCount, 2);
  assert.ok(result.retainedGrowthSpikeUnits >= 1000);
  assert.ok(result.exceptions.includes("sustained_growth_signal"));
});

test("one-off spike exposes its estimated order impact", () => {
  const input = baseInput();
  input.monthlySales[5].unitsSold += 600;
  input.salesTransactions.push(transaction(600, 90));
  const result = first(input);
  assert.equal(result.excludedSpikeCount, 1);
  assert.ok(result.spikeOrderImpactEstimate > 0);
  assert.ok(result.exceptions.includes("one_off_spike"));
});

test("intermittent demand is classified and uses the intermittent-rate strategy", () => {
  const input = baseInput();
  input.monthlySales = sales([0, 0, 90, 0, 0, 90]);
  const result = first(input);
  assert.equal(result.demandPattern, "intermittent");
  assert.equal(result.forecastMethod, "intermittent_rate");
  assert.equal(result.seasonalIndex, 1);
});

test("unknown and late inbound ETA are exposed as planning exceptions", () => {
  const input = baseInput();
  input.inboundShipments = [
    { sku: "SKU-1", productName: "SKU-1", shipmentId: "UNKNOWN", expectedDate: null, quantity: 20 },
    { sku: "SKU-1", productName: "SKU-1", shipmentId: "LATE", expectedDate: "2027-01-01", quantity: 30 },
  ];
  const result = first(input);
  assert.equal(result.goodsInTransitUnknownEta, 20);
  assert.equal(result.goodsInTransitAfterHorizon, 30);
  assert.equal(result.etaAssumptionApplied, true);
  assert.ok(result.exceptions.includes("unknown_eta"));
  assert.ok(result.exceptions.includes("inbound_after_horizon"));
});
