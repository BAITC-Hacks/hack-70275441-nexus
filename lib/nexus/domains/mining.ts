import { metricVocabulary } from "./metricVocabulary.ts";
import type { DomainPack } from "./types.ts";
const metrics = metricVocabulary([
  ["ore_production", "Добыча руды", "t", "neutral", "ore output|добыча руды|добыча|руда добытая"],
  ["waste_moved", "Перемещённая вскрыша", "t", "neutral", "waste movement|вскрыша|горная масса перемещенная"],
  ["stripping_volume", "Объём вскрышных работ", "m3", "neutral", "stripping qty|объем вскрышных работ"],
  ["crushing_volume", "Объём дробления", "t", "neutral", "crushed tonnes|дробление|объем дробления|ДСК объем дробления"],
  ["processing_volume", "Объём переработки", "t", "neutral", "processed tonnes|переработка|объем переработки"],
  ["recovery_rate", "Коэффициент извлечения", "%", "lower_is_worse", "recovery %|коэффициент извлечения|извлечение, %"],
  ["ore_grade", "Содержание в руде", "%", "neutral", "ore content|содержание руды|содержание в руде"],
  ["concentrate_grade", "Содержание в концентрате", "%", "neutral", "concentrate content|содержание концентрата"],
  ["equipment_downtime", "Простой оборудования", "hours", "higher_is_worse", "equipment downtime hours|простой оборудования|простои"],
  ["crusher_downtime", "Простой дробилки", "hours", "higher_is_worse", "crusher downtime hours|простой дробилки|простои ДСК"],
  ["conveyor_downtime", "Простой конвейера", "hours", "higher_is_worse", "conveyor downtime hours|простой конвейера"],
  ["haulage_cycle_time", "Цикл самосвала", "hours", "higher_is_worse", "truck cycle time|цикл самосвала|время рейса"],
  ["truck_utilization", "Загрузка самосвала", "%", "neutral", "truck utilization %|загрузка самосвала"],
  ["excavator_utilization", "Загрузка экскаватора", "%", "neutral", "excavator utilization %|загрузка экскаватора"],
  ["fuel_consumption", "Расход топлива", "liters", "neutral", "diesel consumption|расход ГСМ|расход дизтоплива|расход топлива"],
  ["explosive_consumption", "Расход взрывчатых материалов", "kg", "neutral", "explosives consumption|расход взрывчатых материалов|расход ВМ|БВР расход ВМ"],
  ["plant_throughput", "Производительность фабрики", "t/h", "lower_is_worse", "plant productivity|производительность фабрики|производительность ДСК"],
  ["stockpile_inventory", "Запас руды", "t", "neutral", "ore stock|склад руды|запас в штабеле"],
  ["maintenance_hours", "Время обслуживания", "hours", "neutral", "время обслуживания|часы ремонта"],
  ["production_plan", "План добычи", "t", "neutral", "ore plan|план добычи"],
  ["production_actual", "Факт добычи", "t", "neutral", "ore actual|факт добычи"],
  ["production_gap", "Разрыв добычи", "t", "higher_is_worse", "ore gap|разрыв добычи|отставание добычи"],
], ["production_gap", "recovery_rate"]);
export const MINING: DomainPack = { id: "MINING", labelRu: "Горное производство", labelEn: "Mining", description: "Mining measurements, not deposit assumptions. Bare ДСК, БВР, ГСМ, содержание, руда, рейс and штабель are not measurement aliases. Grades declared as % require source-unit confirmation (g/t is not silently converted).", metrics, outcomeMetrics: ["production_gap", "recovery_rate"], alternativeFactors: [], causalPriors: [{ from: "crusher_downtime", to: "production_gap", relation: "potential_precursor", note: "Hypothesis only. Inspect buffers and processing dependencies; not Evidence." }], detection: { strongMetrics: ["ore_production", "ore_grade", "recovery_rate", "crusher_downtime"], characteristicMetrics: ["waste_moved", "crushing_volume", "processing_volume", "haulage_cycle_time"], minimumMatch: 3, minimumMargin: 3 }, concepts: [], priors: [], forbiddenOverclaims: ["Простой не доказывает причину недовыполнения добычи."], capabilityHints: [], terminology: {} };
