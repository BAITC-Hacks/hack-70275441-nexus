import { metricVocabulary } from "./metricVocabulary.ts";
import type { DomainPack } from "./types.ts";
const metrics = metricVocabulary([
  ["sales_volume", "Объём продаж", "units", "neutral", "sales quantity|продажи|объем продаж|реализация|кол-во продаж"],
  ["revenue", "Выручка", "KZT", "lower_is_worse", "sales revenue|turnover|выручка|оборот"],
  ["gross_profit", "Валовая прибыль", "KZT", "lower_is_worse", "валовая прибыль"],
  ["gross_margin", "Валовая маржа", "%", "lower_is_worse", "gross margin %|маржа|валовая маржа"],
  ["average_selling_price", "Средняя цена продажи", "KZT", "neutral", "avg selling price|средняя цена продажи"],
  ["units_sold", "Продано единиц", "units", "neutral", "sold qty|продано|продано, ед|количество проданных единиц"],
  ["demand", "Спрос", "units", "neutral", "спрос|demand quantity"],
  ["inventory", "Товарный запас", "units", "neutral", "stock|balance|остаток|остатки|товарный запас"],
  ["stockout_rate", "Доля дефицита", "%", "higher_is_worse", "stockout %|дефицит|дефицит, %"],
  ["inventory_turnover", "Оборачиваемость запасов", "index", "neutral", "stock turnover|оборачиваемость запасов|оборот запасов"],
  ["days_inventory", "Дни запаса", "days", "neutral", "days of inventory|дни запаса"],
  ["returns_rate", "Доля возвратов", "%", "higher_is_worse", "return rate|returns %|возвраты, %|доля возвратов"],
  ["discount_rate", "Размер скидки", "%", "neutral", "discount %|скидка|скидка, %"],
  ["conversion_rate", "Конверсия", "%", "lower_is_worse", "conversion %|конверсия|конверсия, %"],
  ["average_order_value", "Средний чек", "KZT", "neutral", "AOV|avg order value|средний чек"],
  ["customer_count", "Количество покупателей", "count", "neutral", "customers count|количество покупателей"],
  ["repeat_purchase_rate", "Доля повторных покупок", "%", "lower_is_worse", "repeat purchase %|доля повторных покупок"],
  ["procurement_cost", "Стоимость закупки", "KZT", "higher_is_worse", "procurement costs|purchase cost|стоимость закупки|затраты на закупку"],
  ["logistics_cost", "Логистические затраты", "KZT", "higher_is_worse", "logistics costs|логистические затраты"],
  ["lead_time", "Срок поставки", "days", "higher_is_worse", "срок поставки|время поставки"],
], ["stockout_rate", "returns_rate", "gross_margin"]);
export const RETAIL: DomainPack = { id: "RETAIL", labelRu: "Розничная торговля и продажи", labelEn: "Retail / Sales", description: "Sales and stock vocabulary. Bare turnover/оборот explicitly means monetary revenue; inventory turnover requires a qualified alias. Declared KZT/% units must be confirmed at import.", metrics, outcomeMetrics: ["stockout_rate", "returns_rate", "gross_margin"], alternativeFactors: [], causalPriors: [{ from: "lead_time", to: "stockout_rate", relation: "potential_precursor", note: "Hypothesis only; supply buffers and demand must be inspected. Not Evidence." }], detection: { strongMetrics: ["units_sold", "average_order_value", "repeat_purchase_rate"], characteristicMetrics: ["sales_volume", "gross_margin", "inventory", "conversion_rate"], minimumMatch: 3, minimumMargin: 3 }, concepts: [], priors: [], forbiddenOverclaims: ["Запасы и продажи не доказывают причинную связь."], capabilityHints: [], terminology: {} };
