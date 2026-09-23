export type DomainId = "RETAIL" | "LOGISTICS" | "MANUFACTURING" | "MINING";
export type MetricRole = "outcome" | "leading_signal" | "driver" | "context" | "alternative_factor";
export type RiskDirection = "higher_is_worse" | "lower_is_worse" | "deviation_is_worse" | "neutral";
export type MetricValueType = "continuous" | "percentage" | "percentage_points" | "currency" | "quantity" | "hours" | "count" | "index";
export type ExpectedLagPeriods = { min?: number; max?: number };
/** Prior domain knowledge only: neither metric roles nor expected lags are Evidence. */
export type DomainMetricDefinition = {
  canonicalName: string;
  labelRu?: string;
  role: MetricRole;
  valueType: MetricValueType;
  unit?: string;
  riskDirection: RiskDirection;
  aliases?: readonly string[];
  expectedLagPeriods?: ExpectedLagPeriods;
  description?: string;
};
/** A candidate inspection hypothesis, never an observed or validated causal finding. */
export type MetricCausalPrior = {
  from: string;
  to: string;
  relation: "potential_precursor";
  expectedLagPeriods?: ExpectedLagPeriods;
  note: string;
};
export type ConceptKind = "ENTITY" | "METRIC" | "DIMENSION";
export type DataType = "NUMERIC" | "CATEGORICAL" | "BOOLEAN" | "DATETIME" | "IDENTIFIER" | "TEXT";
export type UnitFamily = "CURRENCY" | "PERCENTAGE" | "RATIO" | "DAYS" | "HOURS" | "COUNT" | "SCORE" | "QUANTITY" | "DURATION" | "DIMENSIONLESS" | "MASS" | "VOLUME" | "DISTANCE";
export type Direction = "HIGHER_IS_ADVERSE" | "HIGHER_IS_FAVORABLE" | "CONTEXT_DEPENDENT" | "UNKNOWN";
export type AggregationHint = "SUM" | "MEAN" | "MEDIAN" | "COUNT" | "RATE" | "LAST" | "MIN" | "MAX" | "NONE";

/** Vocabulary only: annotations do not authorize mappings, calculations or decisions. */
export type CanonicalConcept = {
  canonicalId: string;
  kind: ConceptKind;
  labelRu: string;
  labelEn: string;
  dataType: DataType;
  aliases: readonly string[];
  unitFamily?: UnitFamily;
  direction?: Direction;
  subdomain?: string;
  validDimensions?: readonly string[];
  aggregationHints?: readonly AggregationHint[];
  valueAliases?: Readonly<Record<string, readonly string[]>>;
  exactOnly?: boolean;
  semanticRole?: string;
  semanticNotes?: readonly string[];
};
export type CausalPrior = {
  from: string;
  to: string;
  relation: "MAY_CONTRIBUTE_TO" | "MAY_PRECEDE";
  note: string;
};
export type DomainPack = {
  id: DomainId;
  labelRu: string;
  labelEn: string;
  description?: string;
  detection?: { strongMetrics: readonly string[]; characteristicMetrics: readonly string[]; excludedMetrics?: readonly string[]; minimumMatch: number; minimumMargin: number };
  concepts: readonly CanonicalConcept[];
  priors: readonly CausalPrior[];
  forbiddenOverclaims: readonly string[];
  capabilityHints: readonly string[];
  terminology: Readonly<Record<string, string>>;
  /** Optional declarations do not authorize column mappings, tool execution or decisions. */
  metrics?: Readonly<Record<string, DomainMetricDefinition>>;
  outcomeMetrics?: readonly string[];
  alternativeFactors?: readonly string[];
  causalPriors?: readonly MetricCausalPrior[];
  scenario?: DomainScenario;
};

export type ModelProvenance = { kind: "domain_calibration" | "demo_calibration" | "historical_estimate" | "configured_assumption"; note: string };
export type DomainScenario = {
  labelRu: string;
  control: { metric: string; allowedDirection: "increase" | "decrease"; unit: string; minChange: number; maxChange: number; step: number; capMetric?: string };
  relationships: readonly { sourceMetric: string; targetMetric: string; effectCoefficient: number; expectedLagPeriods?: number; provenance: ModelProvenance }[];
  bounds: readonly { metric: string; min: number; maxMetric?: string }[];
  intervention: { metric: string; allowedDirection: "increase" | "decrease"; targetMetric: string; targetThreshold: number; rationale: string };
};
