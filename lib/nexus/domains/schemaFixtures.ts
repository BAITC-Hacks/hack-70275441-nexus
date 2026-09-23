/** Small column-only fixtures; no production/pinned dataset changes. */
export const schemaFixtures = {
  retail: ["Выручка", "Остатки", "Средний чек", "Возвраты, %", "Продано"],
  logistics: ["Объем отгрузки", "OTD", "Срок поставки", "Стоимость перевозки", "Загрузка транспорта"],
  manufacturing: ["OEE", "Доля брака", "План производства", "Факт производства", "Внеплановый простой"],
  mining: ["Добыча руды", "Простой дробилки", "Коэффициент извлечения", "Содержание руды", "Расход ГСМ"],
  // Ties RETAIL against LOGISTICS: both share logistics_cost/stockout_rate aliases, then two domain-only
  // strong signals each, producing an identical score (19) — a genuine cross-domain tie, not a fabricated one.
  ambiguous: ["Логистические затраты", "Дефицит, %", "on_time_delivery_rate", "shipment_volume", "average_order_value", "repeat_purchase_rate"],
  unknown: ["date", "value", "Комментарий", "Регион"],
} as const;
