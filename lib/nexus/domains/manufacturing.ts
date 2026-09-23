import { metricVocabulary } from "./metricVocabulary.ts";
import type { DomainPack } from "./types.ts";
const metrics = metricVocabulary([
  ["production_volume", "Объём производства", "units", "neutral", "production qty|объем производства|выпуск"],
  ["planned_production", "План производства", "units", "neutral", "production plan|план производства|плановый выпуск"],
  ["actual_production", "Факт производства", "units", "neutral", "production actual|факт производства|фактический выпуск"],
  ["production_gap", "Разрыв производства", "units", "higher_is_worse", "разрыв производства|дефицит выпуска"],
  ["throughput", "Пропускная способность", "units/h", "neutral", "production throughput|пропускная способность"],
  ["cycle_time", "Время цикла", "hours", "higher_is_worse", "время цикла"],
  ["downtime", "Простой", "hours", "higher_is_worse", "простой|простои|downtime hours"],
  ["unplanned_downtime", "Внеплановый простой", "hours", "higher_is_worse", "внеплановый простой|аварийные простои"],
  ["equipment_utilization", "Загрузка оборудования", "%", "neutral", "equipment utilization %|загрузка оборудования"],
  ["oee", "Эффективность оборудования OEE", "%", "lower_is_worse", "overall equipment effectiveness|общая эффективность оборудования|ОЕЕ"],
  ["defect_rate", "Доля брака", "%", "higher_is_worse", "defect %|доля брака|брак, %"],
  ["scrap_rate", "Доля отходов", "%", "higher_is_worse", "scrap %|доля отходов"],
  ["yield_rate", "Выход годной продукции", "%", "lower_is_worse", "yield %|выход годной продукции"],
  ["raw_material_inventory", "Запас сырья", "units", "neutral", "raw material stock|запас сырья"],
  ["finished_goods_inventory", "Запас готовой продукции", "units", "neutral", "finished goods stock|запас готовой продукции"],
  ["energy_consumption", "Потребление энергии", "kWh", "neutral", "энергопотребление|потребление энергии"],
  ["maintenance_cost", "Затраты на обслуживание", "KZT", "higher_is_worse", "maintenance costs|затраты на обслуживание"],
  ["labor_productivity", "Производительность труда", "units/person/h", "lower_is_worse", "labour productivity|производительность труда|выработка"],
  ["unit_cost", "Себестоимость единицы", "KZT/unit", "higher_is_worse", "unit costs|себестоимость единицы"],
  ["order_backlog", "Портфель невыполненных заказов", "units", "neutral", "невыполненные заказы|портфель заказов"],
], ["production_gap", "defect_rate", "oee"]);
export const MANUFACTURING: DomainPack = { id: "MANUFACTURING", labelRu: "Производство", labelEn: "Manufacturing", description: "Production and equipment vocabulary; no automatic throughput/percentage unit conversion.", metrics, outcomeMetrics: ["production_gap", "defect_rate", "oee"], alternativeFactors: [], causalPriors: [{ from: "unplanned_downtime", to: "production_gap", relation: "potential_precursor", note: "Inspection hypothesis only. Not Evidence or established causality." }], detection: { strongMetrics: ["oee", "defect_rate", "finished_goods_inventory"], characteristicMetrics: ["planned_production", "actual_production", "cycle_time", "scrap_rate"], minimumMatch: 3, minimumMargin: 3 }, concepts: [], priors: [], forbiddenOverclaims: ["Брак не доказывает причину производственного разрыва."], capabilityHints: [], terminology: {} };
