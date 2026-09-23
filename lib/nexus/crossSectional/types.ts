import type { AgentCallTrace, EvidenceRecord, TraceEvent } from "../agentic/types.ts";
export type { AgentCallTrace } from "../agentic/types.ts";

export type TargetResolution = {
  column: string | null;
  source: "EXPLICIT" | "KNOWN_ALIAS" | "NONE";
  kind: "NUMERIC" | "CATEGORICAL" | null;
  authoritative: boolean;
  reason: string;
};

export type NumericSummary = {
  column: string; count: number; missing: number; min: number; max: number;
  mean: number; median: number; standardDeviation: number;
};
export type CategoricalSummary = {
  column: string; count: number; missing: number; distinct: number;
  values: Array<{ value: string; count: number }>;
};
export type NumericAssociation = {
  predictor: string; target: string; method: "PEARSON"; n: number;
  value: number; absoluteStrength: number; causality: "NOT_ESTABLISHED";
};
export type GroupAssociation = {
  predictor: string; target: string; method: "GROUP_MEAN_RANGE"; n: number;
  absoluteStrength: number; groups: Array<{ value: string; count: number; targetMean: number }>;
  causality: "NOT_ESTABLISHED";
};
export type ContingencyAssociation = {
  predictor: string; target: string; method: "CONTINGENCY"; n: number;
  absoluteStrength: null; cells: Array<{ predictorValue: string; targetValue: string; count: number }>;
  causality: "NOT_ESTABLISHED";
};
export type NumericByTargetAssociation = {
  predictor: string; target: string; method: "NUMERIC_BY_TARGET_GROUP"; n: number;
  absoluteStrength: number; groups: Array<{ value: string; count: number; predictorMean: number }>;
  causality: "NOT_ESTABLISHED";
};
export type CrossSectionalAssociation = NumericAssociation | GroupAssociation | NumericByTargetAssociation | ContingencyAssociation;

export type HighRiskEntity = {
  entityId: string; sourceRow: number; targetValue: number | string;
  reasons: string[]; evidenceRefs: string[];
};
export type DatasetIdentity = { name: string; version: string; entityColumn: string; entityCount: number; };
export type CrossSectionalAnalysis = {
  dataset: DatasetIdentity;
  target: TargetResolution;
  numericSummaries: NumericSummary[];
  categoricalSummaries: CategoricalSummary[];
  associations: CrossSectionalAssociation[];
  drivers: CrossSectionalAssociation[];
  highRisk: { rule: string; threshold: number | string | null; entities: HighRiskEntity[] };
  delinquencyPrevalence: { column: string | null; affected: number; total: number; rate: number | null };
  limitations: string[];
};

export type NarrativeAgentOutput = {
  selectedTool: string | null;
  hypothesis: string;
  alternativeExplanation: string;
  rationale: string;
  evidenceRefs: string[];
};
export type SkepticNarrativeOutput = {
  selectedTool: string | null;
  status: "SUPPORTED" | "CHALLENGED" | "INCONCLUSIVE";
  challenge: string;
  alternativeExplanation: string;
  evidenceRefs: string[];
};
export type CrossSectionalArtifact = {
  workflowId: "cross-sectional-investigation";
  analysis: CrossSectionalAnalysis;
  observerFindings: string[];
  investigator: NarrativeAgentOutput & { source: "LLM" | "FALLBACK" };
  skeptic: SkepticNarrativeOutput & { source: "LLM" | "FALLBACK" };
  evidence: EvidenceRecord[];
  /** Evidence the live Investigator/Skeptic created themselves by genuinely calling a bounded tool — kept separate from the fixed `evidence` baseline so the pre-existing EVIDENCE_CONTENT/ANALYSIS_ARTIFACT validator checks and artifact hashing never have to change shape. Empty when no live tool call happened this run. */
  onDemandEvidence: EvidenceRecord[];
  trace: TraceEvent[];
  technicalTrace: { toolCalls: number; llmCalls: number; bounded: true; causality: "NOT_ESTABLISHED"; agentCalls: AgentCallTrace[] };
};
export type ValidationCheck = { id: string; passed: boolean; detail: string };
export type CrossSectionalValidation = {
  status: "VALIDATED" | "BLOCKED";
  checks: ValidationCheck[];
  validatedArtifactHash: string;
};
export type CrossSectionalWorkflowResult = {
  kind: "CROSS_SECTIONAL";
  artifact: CrossSectionalArtifact;
  validation: CrossSectionalValidation;
};

export type CrossSectionalFixtureMetadata = {
  datasetName: string;
  targetProvenance?: { target: string; kind: "SUPPLIED_DERIVED_SCORE"; derivedFrom: string[]; formula: string };
};
