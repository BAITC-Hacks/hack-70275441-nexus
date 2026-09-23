import { metricVocabulary } from "./metricVocabulary.ts";
import type { DomainPack } from "./types.ts";
const metrics = metricVocabulary([
  ["shipment_volume", "Объём отгрузки", "units", "neutral", "shipment qty|объем отгрузки|отгружено|кол-во отгружено"],
  ["delivered_qty", "Поставленное количество", "units", "neutral", "delivered quantity|delivered volume|поставлено|кол-во поставлено"],
  ["on_time_delivery_rate", "Доля своевременных поставок", "%", "lower_is_worse", "OTD|доля своевременных поставок"],
  ["lead_time", "Срок поставки", "days", "higher_is_worse", "срок поставки"],
  ["transit_time", "Время в пути", "hours", "higher_is_worse", "время в пути|срок перевозки"],
  ["logistics_cost", "Логистические затраты", "KZT", "higher_is_worse", "logistics costs|логистические затраты"],
  ["freight_cost", "Стоимость перевозки", "KZT", "higher_is_worse", "freight costs|стоимость перевозки|фрахт"],
  ["fuel_cost", "Стоимость топлива", "KZT", "higher_is_worse", "fuel costs|стоимость топлива"],
  ["warehouse_inventory", "Складской запас", "units", "neutral", "warehouse stock|складской запас"],
  ["warehouse_utilization", "Загрузка склада", "%", "neutral", "warehouse utilization %|загрузка склада"],
  ["order_fulfillment_rate", "Доля выполненных заказов", "%", "lower_is_worse", "fulfillment %|доля выполненных заказов"],
  ["fill_rate", "Полнота исполнения", "%", "lower_is_worse", "fill %|полнота исполнения"],
  ["backorder_qty", "Отложенные заказы", "units", "higher_is_worse", "backorder quantity|отложенные заказы"],
  ["stockout_rate", "Доля дефицита", "%", "higher_is_worse", "stockout %|дефицит, %"],
  ["damaged_goods_rate", "Доля повреждённых товаров", "%", "higher_is_worse", "damaged goods %|доля поврежденных товаров"],
  ["route_distance", "Расстояние маршрута", "km", "neutral", "расстояние маршрута|длина маршрута"],
  ["vehicle_utilization", "Загрузка транспорта", "%", "neutral", "vehicle utilization %|загрузка транспорта"],
  ["delivery_delay", "Задержка доставки", "days", "higher_is_worse", "задержка доставки|просрочка доставки"],
  ["supplier_lead_time", "Срок поставщика", "days", "higher_is_worse", "срок поставщика"],
  ["eta_accuracy", "Точность прогноза прибытия", "%", "lower_is_worse", "ETA accuracy|точность прогноза прибытия|точность ETA"],
  ["pod_completion_rate", "Доля подтверждённых доставок", "%", "lower_is_worse", "POD rate|proof of delivery rate|доля подтверждённых доставок|доля POD"],
], ["on_time_delivery_rate", "delivery_delay", "damaged_goods_rate"]);
export const LOGISTICS: DomainPack = { id: "LOGISTICS", labelRu: "Логистика и цепочки поставок", labelEn: "Logistics / Supply Chain", description: "Shipment, transport and fulfillment vocabulary; declared units require source confirmation.", metrics, outcomeMetrics: ["on_time_delivery_rate", "delivery_delay", "damaged_goods_rate"], alternativeFactors: [], causalPriors: [{ from: "supplier_lead_time", to: "delivery_delay", relation: "potential_precursor", note: "Inspection hypothesis only, not Evidence or causal proof." }], detection: { strongMetrics: ["on_time_delivery_rate", "shipment_volume", "vehicle_utilization"], characteristicMetrics: ["transit_time", "freight_cost", "route_distance", "order_fulfillment_rate"], minimumMatch: 3, minimumMargin: 3 }, concepts: [], priors: [], forbiddenOverclaims: ["Задержка не устанавливает вину поставщика."], capabilityHints: [], terminology: {} };
