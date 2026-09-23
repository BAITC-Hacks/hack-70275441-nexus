import type { EvidenceRecord, InvestigationProgress, TraceEvent } from "../agentic/types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { admitInvestigation } from "../universal/admission.ts";
import { runCrossSectionalAgents, type CrossSectionalAgentRuns } from "./agents.ts";
import { buildCrossSectionalEvidence } from "./evidence.ts";
import { fixtureMetadataFor } from "./metadata.ts";
import { analyzeCrossSectional } from "./tools.ts";
import type { CrossSectionalAnalysis, CrossSectionalArtifact, CrossSectionalFixtureMetadata, CrossSectionalWorkflowResult } from "./types.ts";
import { assertPublishableCrossSectionalResult, validateCrossSectionalArtifact } from "./validator.ts";

const now = () => new Date().toISOString();
export type CrossSectionalAgentRunner = (analysis: CrossSectionalAnalysis, evidence: EvidenceRecord[], metadata?: CrossSectionalFixtureMetadata, objective?: string) => Promise<CrossSectionalAgentRuns>;

function observerFindings(analysis: CrossSectionalAnalysis): string[] {
  const top = analysis.drivers[0];
  const dominantCategory = analysis.categoricalSummaries.flatMap((summary) => summary.values.slice(0, 1).map((value) => ({ column: summary.column, ...value }))).sort((a, b) => b.count - a.count || a.column.localeCompare(b.column))[0];
  return [
    `${analysis.dataset.entityCount} entity records were admitted; row order was not used as time.`,
    analysis.target.column ? `${analysis.target.column} is the confirmed ${analysis.target.source.toLowerCase()} target.` : analysis.target.reason,
    top ? `${top.predictor} is the strongest ranked association with ${top.target} under ${top.method}; causality is not established.` : "No ranked target driver was produced.",
    dominantCategory ? `${dominantCategory.column} has the largest observed category concentration in ${dominantCategory.value}.` : "No categorical concentration was available.",
    `${analysis.highRisk.entities.length} entities meet the explicit high-risk selection rule.`,
  ];
}

export async function runCrossSectionalInvestigation(input: { dataset: UploadedDataset; signals: string[]; target?: string; objective?: string; taskId?: string; onProgress?: (progress: InvestigationProgress) => void }, agentRunner: CrossSectionalAgentRunner = runCrossSectionalAgents): Promise<CrossSectionalWorkflowResult> {
  const route = admitInvestigation({ dataset: input.dataset, signals: input.signals, taskId: input.taskId, intent: "INVESTIGATE", mapping: { target: input.target } });
  if (route.status !== "PROCEED" || route.workflowId !== "cross-sectional-investigation") throw new Error(`Cross-sectional workflow denied by route ${route.status}.`);
  input.onProgress?.({ stage: "DATA_ACQUIRED", source: "DETERMINISTIC", detail: "Cross-sectional entity table admitted; row order will not be treated as time." });
  const metadata = fixtureMetadataFor(input.dataset); const analysis = analyzeCrossSectional(input.dataset, input.target, metadata); const evidence = buildCrossSectionalEvidence(analysis, metadata); const observed = observerFindings(analysis);
  input.onProgress?.({ stage: "SIGNALS_DETECTED", source: "DETERMINISTIC", detail: "Entity distributions, segments, associations and attention records were computed." });
  input.onProgress?.({ stage: "INVESTIGATOR_SELECTING_CHECK", source: process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK", detail: "Investigator is interpreting bounded deterministic cross-sectional evidence." });
  const agents = await agentRunner(analysis, evidence, metadata, input.objective);
  input.onProgress?.({ stage: "HYPOTHESIS_FORMED", source: agents.investigator.source, detail: agents.investigator.source === "LLM" ? "Investigator returned a narrative hypothesis using Evidence references." : "Investigator used the conservative fallback; deterministic analysis remains intact." });
  input.onProgress?.({ stage: "SKEPTIC_CHALLENGING", source: agents.skeptic.source, detail: "Skeptic reviewed leakage, circularity, confounding, subgroup size and causal limits." });
  const onDemandEvidence = agents.onDemandEvidence ?? [];
  const toolTrace = agents.toolTrace ?? [];
  // On-demand tool calls the live agents genuinely triggered — truthfully placed between the agent that
  // selected the tool and the hypothesis/verdict it fed into, using only existing TraceEventType values.
  const onDemandTrace = (role: "INVESTIGATOR" | "SKEPTIC"): TraceEvent[] =>
    toolTrace
      .filter((item) => item.role === role)
      .flatMap((item): TraceEvent[] => {
        const record = onDemandEvidence.find((evidenceItem) => evidenceItem.id === item.evidenceId);
        return [
          { timestamp: now(), agent: role, event: "AGENT_DECISION", summary: `${role === "INVESTIGATOR" ? "Investigator" : "Skeptic"} selected ${item.tool}.`, tool: item.tool, source: "LLM", ...(item.metadata?.targetedAssumption ? { metadata: item.metadata, summary: `Проверяемое предположение: ${item.metadata.targetedAssumption}. Выбран инструмент ${item.tool}.` } : {}) },
          { timestamp: now(), agent: "TOOL", event: "TOOL_CALLED", summary: `Running ${item.tool}.`, tool: item.tool, source: "DETERMINISTIC" },
          { timestamp: now(), agent: "TOOL", event: "TOOL_RESULT", summary: record?.result ?? "", tool: item.tool, evidenceRefs: [item.evidenceId], source: "DETERMINISTIC" },
        ];
      });
  const trace: TraceEvent[] = [
    { timestamp: now(), agent: "ORCHESTRATOR", event: "INVESTIGATION_STARTED", summary: "cross-sectional-investigation admitted by shape and intent.", source: "DETERMINISTIC" },
    { timestamp: now(), agent: "OBSERVER", event: "AGENT_DECISION", summary: "Observer ranked deterministic cross-sectional findings without causal claims.", evidenceRefs: evidence.filter((item) => item.usedBy.includes("OBSERVER")).map((item) => item.id), source: "DETERMINISTIC" },
    ...evidence.flatMap((item): TraceEvent[] => [{ timestamp: now(), agent: "TOOL", event: "TOOL_CALLED", summary: `Running ${item.tool}.`, tool: item.tool, source: "DETERMINISTIC" }, { timestamp: now(), agent: "TOOL", event: "TOOL_RESULT", summary: item.result, tool: item.tool, evidenceRefs: [item.id], source: "DETERMINISTIC" }]),
    ...onDemandTrace("INVESTIGATOR"),
    { timestamp: now(), agent: "INVESTIGATOR", event: "HYPOTHESIS_CREATED", summary: agents.investigator.rationale, tool: agents.investigator.selectedTool ?? undefined, evidenceRefs: agents.investigator.evidenceRefs, source: agents.investigator.source },
    ...onDemandTrace("SKEPTIC"),
    { timestamp: now(), agent: "SKEPTIC", event: "CHALLENGE_CREATED", summary: agents.skeptic.challenge, tool: agents.skeptic.selectedTool ?? undefined, evidenceRefs: agents.skeptic.evidenceRefs, source: agents.skeptic.source },
  ];
  const artifact: CrossSectionalArtifact = { workflowId: "cross-sectional-investigation", analysis, observerFindings: observed, investigator: agents.investigator, skeptic: agents.skeptic, evidence, onDemandEvidence, trace, technicalTrace: { toolCalls: evidence.length + onDemandEvidence.length, llmCalls: agents.llmCalls, bounded: true, causality: "NOT_ESTABLISHED", agentCalls: agents.agentCalls } };
  const validation = validateCrossSectionalArtifact(input.dataset, artifact, input.target, metadata);
  if (validation.status !== "VALIDATED") throw new Error(`Cross-sectional validation blocked finalization: ${validation.checks.filter((check) => !check.passed).map((check) => check.id).join(", ")}`);
  assertPublishableCrossSectionalResult(artifact, validation);
  input.onProgress?.({ stage: "VERDICT_READY", source: "DETERMINISTIC", detail: "Independent validator recomputed the artifact; final publication is allowed." });
  return { kind: "CROSS_SECTIONAL", artifact, validation };
}
