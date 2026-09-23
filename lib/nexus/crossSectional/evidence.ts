import type { EvidenceRecord } from "../agentic/types.ts";
import type { CrossSectionalAnalysis, CrossSectionalFixtureMetadata } from "./types.ts";

export function buildCrossSectionalEvidence(analysis: CrossSectionalAnalysis, metadata?: CrossSectionalFixtureMetadata): EvidenceRecord[] {
  const evidence: EvidenceRecord[] = [
    { id: "E-001", tool: "profile_cross_sectional_dataset", variables: [], result: `Профилировано ${analysis.dataset.entityCount} сущностей из ${analysis.dataset.name}; версия ${analysis.dataset.version}.`, data: analysis.dataset, usedBy: ["OBSERVER"] },
    { id: "E-002", tool: "summarize_numeric_columns", variables: analysis.numericSummaries.map((item) => item.column), result: `Обобщено ${analysis.numericSummaries.length} числовых колонок по исходным значениям.`, data: { summaries: analysis.numericSummaries }, usedBy: ["OBSERVER", "INVESTIGATOR"] },
    { id: "E-003", tool: "summarize_categorical_columns", variables: analysis.categoricalSummaries.map((item) => item.column), result: `Обобщено ${analysis.categoricalSummaries.length} категориальных колонок с точными количествами.`, data: { summaries: analysis.categoricalSummaries }, usedBy: ["OBSERVER", "INVESTIGATOR"] },
    { id: "E-004", tool: "calculate_cross_sectional_associations", variables: analysis.associations.flatMap((item) => [item.predictor, item.target]), result: analysis.target.column ? `Рассчитано ${analysis.associations.length} связей с заданным показателем ${analysis.target.column}; причинность не установлена.` : "Подтверждённый итоговый показатель отсутствует; связи с итоговым показателем не рассчитаны.", data: { target: analysis.target, associations: analysis.associations, drivers: analysis.drivers }, usedBy: ["OBSERVER", "INVESTIGATOR", "SKEPTIC"] },
    { id: "E-005", tool: "identify_high_risk_entities", variables: analysis.target.column ? [analysis.target.column] : [], result: `Отобрано ${analysis.highRisk.entities.length} записей по опубликованному правилу: ${analysis.highRisk.rule}`, data: analysis.highRisk, usedBy: ["OBSERVER", "INVESTIGATOR", "SKEPTIC"] },
    { id: "E-006", tool: "compare_delinquency_segment", variables: analysis.delinquencyPrevalence.column?.split("|") ?? [], result: analysis.delinquencyPrevalence.rate === null ? "Поддерживаемое поле просрочки отсутствует." : `${analysis.delinquencyPrevalence.affected} из ${analysis.delinquencyPrevalence.total} записей имеют положительное значение текущей или 12-месячной просрочки.`, data: analysis.delinquencyPrevalence, usedBy: ["OBSERVER", "SKEPTIC"] },
  ];
  if (metadata?.targetProvenance) evidence.push({ id: "E-007", tool: "inspect_target_provenance", variables: [metadata.targetProvenance.target, ...metadata.targetProvenance.derivedFrom], result: `Подготовленные метаданные показывают, что ${metadata.targetProvenance.target} — заданный производный показатель.`, data: metadata.targetProvenance, usedBy: ["SKEPTIC"] });
  return evidence;
}
