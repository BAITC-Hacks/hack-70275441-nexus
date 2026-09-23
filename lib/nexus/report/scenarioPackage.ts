import { simulateDomainScenario, analyzeDomainIntervention } from "../../engine/domainSimulation.ts";
import { stableHash } from "../crossSectional/tools.ts";
import { verifyExecution } from "../action/exportDecision.ts";
import type { ActionRecord } from "../action/types.ts";
import type { EligibleWorkflowResult } from "../action/proposeAction.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { buildInvestigationViewModel } from "./investigationViewModel.ts";

export type ScenarioPackageInput = { result: Extract<EligibleWorkflowResult, { kind: "TIME_SERIES" }>; dataset: UploadedDataset; domainId: string; changePct: number; action: ActionRecord };
/** Supplemental model review package; never changes the observed ActionRecord or Evidence. */
export function buildScenarioReviewPackage(input: ScenarioPackageInput): string {
  const { result, dataset, action } = input;
  if (result.validation.status !== "VALIDATED" || stableHash(result.artifact) !== result.validation.validatedArtifactHash || stableHash({ columns: dataset.columns, rows: dataset.rows }) !== result.artifact.dataset.version || action.status !== "VERIFIED" || !action.execution || verifyExecution(result, action.proposal, action.execution.files).status !== "VERIFIED") throw new Error("Observed export or dataset binding is invalid.");
  const model = buildInvestigationViewModel({ artifact: result.artifact, validation: result.validation, dataset, evidence: [], domainId: input.domainId });
  if (!model.scenario) throw new Error("Scenario unavailable.");
  const scenario = simulateDomainScenario({ ...model.scenario.input, changePct: input.changePct });
  if (scenario.status !== "AVAILABLE") throw new Error(scenario.reason);
  return JSON.stringify({ format: "MODEL_REVIEW_PACKAGE", validatedArtifactHash: result.validation.validatedArtifactHash,
    observed: { kind: "OBSERVED", target: result.artifact.inputs.target, latestValue: model.latest?.value, leadingSignals: result.artifact.precursorChain.edges, verifiedDecisionFiles: action.execution.files },
    scenario: { kind: "SIMULATION", result: scenario }, assumptions: { kind: "MODEL_ASSUMPTION", relationships: scenario.assumptions },
    intervention: { kind: "INTERVENTION_ANALYSIS", result: analyzeDomainIntervention(model.scenario.input) },
    disclaimer: "Сценарная рекомендация для операционной проверки. Не наблюдаемый результат, не прогноз, не доказанно оптимальное решение. Строительное вмешательство не выполнено." }, null, 2);
}
export function verifyScenarioReviewPackage(input: ScenarioPackageInput, content: string): boolean {
  try { return content === buildScenarioReviewPackage(input); } catch { return false; }
}
