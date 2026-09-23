import type { BoundedTool } from "../agentic/boundedRuntime/runtime.ts";
import type { CrossSectionalAnalysis, CrossSectionalFixtureMetadata } from "./types.ts";

/**
 * These tools never take an agent-supplied argument — every one of them reveals a slice of the
 * `CrossSectionalAnalysis` that `analyzeCrossSectional()` already computed deterministically before any
 * agent ran (see `workflow.ts`). Calling one is a real function call that creates a genuine, auditable
 * Evidence record the agent may then cite — but it can never change target resolution, target provenance,
 * or the high-risk/entity-ranking rule, because none of those are exposed here at all.
 */
export interface CrossSectionalToolContext {
  analysis: CrossSectionalAnalysis;
  metadata?: CrossSectionalFixtureMetadata;
}

export const crossSectionalLiveTools: BoundedTool<CrossSectionalToolContext>[] = [
  {
    name: "summarize_numeric_columns",
    description: "Reveal the deterministic per-column numeric summary (count, missing, min, max, mean, median, standard deviation) already computed for this dataset.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: `Обобщено ${context.analysis.numericSummaries.length} числовых колонок по исходным значениям.`,
      data: { summaries: context.analysis.numericSummaries },
      variables: context.analysis.numericSummaries.map((item) => item.column),
    }),
  },
  {
    name: "summarize_categorical_columns",
    description: "Reveal the deterministic per-column categorical value counts already computed for this dataset.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: `Обобщено ${context.analysis.categoricalSummaries.length} категориальных колонок с точными количествами.`,
      data: { summaries: context.analysis.categoricalSummaries },
      variables: context.analysis.categoricalSummaries.map((item) => item.column),
    }),
  },
  {
    name: "calculate_cross_sectional_associations",
    description: "Reveal the deterministic predictor associations already computed against the confirmed target column.",
    allowedAgents: ["INVESTIGATOR"],
    argumentKind: "none",
    execute: (context) => ({
      summary: context.analysis.target.column
        ? `Рассчитано ${context.analysis.associations.length} связей с заданным показателем ${context.analysis.target.column}; причинность не установлена.`
        : "Подтверждённый итоговый показатель отсутствует; связи с итоговым показателем не рассчитаны.",
      data: { target: context.analysis.target, associations: context.analysis.associations, drivers: context.analysis.drivers },
      variables: context.analysis.associations.flatMap((item) => [item.predictor, item.target]),
    }),
  },
  {
    name: "inspect_target_provenance",
    description: "Reveal any prepared-fixture provenance metadata recorded for the confirmed target column.",
    allowedAgents: ["SKEPTIC"],
    argumentKind: "none",
    execute: (context) =>
      context.metadata?.targetProvenance
        ? {
            summary: `Подготовленные метаданные показывают, что ${context.metadata.targetProvenance.target} — заданный производный показатель.`,
            data: { ...context.metadata.targetProvenance },
            variables: [context.metadata.targetProvenance.target, ...context.metadata.targetProvenance.derivedFrom],
          }
        : { summary: "Подготовленные метаданные о происхождении для заданного показателя отсутствуют.", data: {}, variables: [] },
  },
  {
    name: "compare_delinquency_segment",
    description: "Reveal the deterministic current/12-month delinquency prevalence already computed for this dataset.",
    allowedAgents: ["SKEPTIC"],
    argumentKind: "none",
    execute: (context) => ({
      summary:
        context.analysis.delinquencyPrevalence.rate === null
          ? "Поддерживаемое поле просрочки отсутствует."
          : `${context.analysis.delinquencyPrevalence.affected} из ${context.analysis.delinquencyPrevalence.total} записей имеют положительное значение текущей или 12-месячной просрочки.`,
      data: { ...context.analysis.delinquencyPrevalence },
      variables: context.analysis.delinquencyPrevalence.column?.split("|") ?? [],
    }),
  },
];
