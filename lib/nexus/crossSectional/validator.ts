import type { EvidenceRecord } from "../agentic/types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { containsAuthoritativeMetric } from "./agents.ts";
import { buildCrossSectionalEvidence } from "./evidence.ts";
import { crossSectionalLiveTools, type CrossSectionalToolContext } from "./liveTools.ts";
import { analyzeCrossSectional, stableHash, stableStringify } from "./tools.ts";
import type { CrossSectionalAnalysis, CrossSectionalArtifact, CrossSectionalFixtureMetadata, CrossSectionalValidation, ValidationCheck } from "./types.ts";

const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);

/**
 * The one addition this bounded-runtime change makes to this validator: every on-demand Evidence record
 * (created by a live tool call, never part of the fixed `buildCrossSectionalEvidence` baseline) must be
 * independently reproducible by re-running its own recorded tool with its own recorded argument — the same
 * "recompute and diff" principle the rest of this validator already applies to the whole artifact, just
 * applied per-record for the on-demand subset. This never touches `EVIDENCE_CONTENT`/`ANALYSIS_ARTIFACT`
 * or any other existing check, and the fixed baseline evidence array/shape is untouched.
 */
function reproducible(record: EvidenceRecord, analysis: CrossSectionalAnalysis, metadata?: CrossSectionalFixtureMetadata): boolean {
  const tool = crossSectionalLiveTools.find((item) => item.name === record.tool);
  if (!tool) return false;
  const context: CrossSectionalToolContext = { analysis, metadata };
  const id = typeof record.data.requestedId === "string" ? record.data.requestedId : null;
  if (tool.argumentKind === "id" && (id === null || !(tool.validIds?.(context) ?? []).includes(id))) return false;
  if (tool.argumentKind === "none" && id !== null) return false;
  const result = tool.execute(context, id);
  const expectedData = id !== null ? { ...result.data, requestedId: id } : result.data;
  return same(result.summary, record.result) && same(expectedData, record.data) && same(result.variables, record.variables);
}

export function validateCrossSectionalArtifact(dataset: UploadedDataset, artifact: CrossSectionalArtifact, explicitTarget?: string, metadata?: CrossSectionalFixtureMetadata): CrossSectionalValidation {
  const recomputed = analyzeCrossSectional(dataset, explicitTarget, metadata);
  const expectedEvidence = buildCrossSectionalEvidence(recomputed, metadata);
  const onDemand = artifact.onDemandEvidence ?? [];
  const allEvidence = [...artifact.evidence, ...onDemand];
  const ids = new Set(allEvidence.map((item) => item.id));
  const refs = [...artifact.investigator.evidenceRefs, ...artifact.skeptic.evidenceRefs, ...artifact.analysis.highRisk.entities.flatMap((entity) => entity.evidenceRefs), ...artifact.trace.flatMap((item) => item.evidenceRefs ?? [])];
  const checks: ValidationCheck[] = [
    { id: "DATASET_IDENTITY_VERSION", passed: artifact.analysis.dataset.name === dataset.name && artifact.analysis.dataset.version === recomputed.dataset.version, detail: "Dataset name and content fingerprint match the admitted source." },
    { id: "ENTITY_COUNT", passed: artifact.analysis.dataset.entityCount === dataset.rows.length, detail: "Entity count matches source rows." },
    { id: "TARGET_RESOLUTION", passed: same(artifact.analysis.target, recomputed.target), detail: "Target resolution was independently recomputed." },
    { id: "NUMERIC_SUMMARIES", passed: same(artifact.analysis.numericSummaries, recomputed.numericSummaries), detail: "Numeric summaries match independent recomputation." },
    { id: "CATEGORY_COUNTS", passed: same(artifact.analysis.categoricalSummaries, recomputed.categoricalSummaries), detail: "Category counts match independent recomputation." },
    { id: "ASSOCIATIONS", passed: same({ associations: artifact.analysis.associations, drivers: artifact.analysis.drivers }, { associations: recomputed.associations, drivers: recomputed.drivers }), detail: "Associations and driver ordering match independent recomputation." },
    { id: "HIGH_RISK_SELECTION", passed: same(artifact.analysis.highRisk, recomputed.highRisk), detail: "Entity selection, ranking, row references and reasons match the published rule." },
    { id: "DERIVED_PREVALENCE", passed: same(artifact.analysis.delinquencyPrevalence, recomputed.delinquencyPrevalence), detail: "Delinquency prevalence matches source rows." },
    { id: "ANALYSIS_ARTIFACT", passed: same(artifact.analysis, recomputed), detail: "The complete deterministic analysis matches independent recomputation." },
    { id: "EVIDENCE_CONTENT", passed: same(artifact.evidence, expectedEvidence), detail: "Evidence IDs and deterministic tool payloads match the recomputed artifact." },
    { id: "EVIDENCE_REFERENCES", passed: ids.size === allEvidence.length && refs.every((id) => ids.has(id)), detail: "Every agent, trace and entity reference resolves to canonical evidence, baseline or on-demand." },
    { id: "ON_DEMAND_EVIDENCE_REPRODUCIBLE", passed: onDemand.every((record) => reproducible(record, recomputed, metadata)), detail: "Every agent-requested (on-demand) Evidence record is independently reproducible from its recorded tool and argument." },
    { id: "AGENT_NUMERICAL_AUTHORITY", passed: !containsAuthoritativeMetric(artifact.investigator) && !containsAuthoritativeMetric(artifact.skeptic), detail: "Agent schemas contain narrative and Evidence references only; no authoritative metric appears in agent text." },
    { id: "WORKFLOW_COMPATIBILITY", passed: artifact.workflowId === "cross-sectional-investigation" && artifact.technicalTrace.causality === "NOT_ESTABLISHED", detail: "Artifact declares the admitted workflow and does not assert causality." },
  ];
  return { status: checks.every((check) => check.passed) ? "VALIDATED" : "BLOCKED", checks, validatedArtifactHash: stableHash(artifact) };
}

export function publishedArtifactMatches(artifact: CrossSectionalArtifact, validation: CrossSectionalValidation): boolean {
  return validation.status === "VALIDATED" && stableHash(artifact) === validation.validatedArtifactHash;
}

export function assertPublishableCrossSectionalResult(artifact: CrossSectionalArtifact, validation: CrossSectionalValidation): void {
  if (!publishedArtifactMatches(artifact, validation)) throw new Error("Cross-sectional finalization blocked: the published artifact does not match the validated artifact.");
}
