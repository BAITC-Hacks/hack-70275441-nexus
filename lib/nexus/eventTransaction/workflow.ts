import type { EvidenceRecord, InvestigationProgress, TraceEvent } from "../agentic/types.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { admitInvestigation } from "../universal/admission.ts";
import { runEventAgents, type EventAgentRuns } from "./agents.ts";
import { buildEventTransactionEvidence } from "./evidence.ts";
import { analyzeEventTransactions } from "./tools.ts";
import type { EventTransactionAnalysis, EventTransactionWorkflowResult } from "./types.ts";
import { assertPublishableEventResult, validateEventTransactionArtifact } from "./validator.ts";

const now = () => new Date().toISOString();
export type EventAgentRunner = (analysis: EventTransactionAnalysis, evidence: EvidenceRecord[], objective?: string, options?: { dataset?: UploadedDataset }) => Promise<EventAgentRuns>;
export async function runEventTransactionInvestigation(input: { dataset: UploadedDataset; signals: string[]; objective?: string; taskId?: string; onProgress?: (progress: InvestigationProgress) => void }, agentRunner: EventAgentRunner = runEventAgents): Promise<EventTransactionWorkflowResult> {
  const route = admitInvestigation({ dataset: input.dataset, signals: input.signals, taskId: input.taskId, intent: "INVESTIGATE" });
  if (route.status !== "PROCEED" || route.workflowId !== "event-transaction-investigation") throw new Error(`Event workflow denied by route ${route.status}.`);
  input.onProgress?.({ stage: "DATA_ACQUIRED", source: "DETERMINISTIC", detail: "Event/transaction table admitted; each row is treated as a source event." });
  const analysis = analyzeEventTransactions(input.dataset), evidence = buildEventTransactionEvidence(analysis);
  const observerFindings = [`${analysis.dataset.eventCount} events and ${analysis.profile.uniqueEntities} entities were profiled.`, `${analysis.eventTypes.length} event types were counted.`, `${analysis.timing.bursts.length} bursts and ${analysis.detection.repeatedPatterns.length} repeated patterns matched published rules.`, `${analysis.detection.notableEvents.length} source events and ${analysis.highlightedEntities.length} entities have deterministic attention reasons.`, "These patterns carry no fraud, security, failure or causal label."];
  input.onProgress?.({ stage: "SIGNALS_DETECTED", source: "DETERMINISTIC", detail: "Event frequencies, entity activity, timing, repetitions and neutral activity clusters were computed." });
  input.onProgress?.({ stage: "INVESTIGATOR_SELECTING_CHECK", source: process.env.OPENAI_API_KEY ? "LLM" : "FALLBACK", detail: "Investigator is selecting a bounded event capability and interpreting Evidence references." });
  const agents = await agentRunner(analysis, evidence, input.objective, { dataset: input.dataset });
  input.onProgress?.({ stage: "HYPOTHESIS_FORMED", source: agents.investigator.source, detail: agents.investigator.source === "LLM" ? "Investigator returned a neutral Evidence-grounded hypothesis." : "Investigator used conservative fallback; deterministic event evidence remains intact." });
  input.onProgress?.({ stage: "SKEPTIC_CHALLENGING", source: agents.skeptic.source, detail: "Skeptic reviewed benign explanations, duplication, identifiers, timestamps, collection artifacts and baseline size." });
  const onDemandEvidence = agents.onDemandEvidence ?? [];
  const toolTrace = agents.toolTrace ?? [];
  const onDemandTrace = (role: "INVESTIGATOR" | "SKEPTIC"): TraceEvent[] =>
    toolTrace
      .filter((item) => item.role === role)
      .flatMap((item): TraceEvent[] => {
        const record = onDemandEvidence.find((evidenceItem) => evidenceItem.id === item.evidenceId);
        return [
          { timestamp: now(), agent: role, event: "AGENT_DECISION", summary: `${role === "INVESTIGATOR" ? "Investigator" : "Skeptic"} selected ${item.tool}${item.id ? ` for ${item.id}` : ""}.`, tool: item.tool, source: "LLM", ...(item.metadata?.targetedAssumption ? { metadata: item.metadata, summary: `Проверяемое предположение: ${item.metadata.targetedAssumption}. Выбран инструмент ${item.tool}.` } : {}) },
          { timestamp: now(), agent: "TOOL", event: "TOOL_CALLED", summary: `Running ${item.tool}.`, tool: item.tool, source: "DETERMINISTIC" },
          { timestamp: now(), agent: "TOOL", event: "TOOL_RESULT", summary: record?.result ?? "", tool: item.tool, evidenceRefs: [item.evidenceId], source: "DETERMINISTIC" },
        ];
      });
  const trace: TraceEvent[] = [{ timestamp: now(), agent: "ORCHESTRATOR", event: "INVESTIGATION_STARTED", summary: "event-transaction-investigation admitted by shape and intent.", source: "DETERMINISTIC" }, { timestamp: now(), agent: "OBSERVER", event: "AGENT_DECISION", summary: "Observer produced deterministic event observations without domain labels.", evidenceRefs: evidence.filter((item) => item.usedBy.includes("OBSERVER")).map((item) => item.id), source: "DETERMINISTIC" }, ...evidence.flatMap((item): TraceEvent[] => [{ timestamp: now(), agent: "TOOL", event: "TOOL_CALLED", summary: `Running ${item.tool}.`, tool: item.tool, source: "DETERMINISTIC" }, { timestamp: now(), agent: "TOOL", event: "TOOL_RESULT", summary: item.result, tool: item.tool, evidenceRefs: [item.id], source: "DETERMINISTIC" }]), ...onDemandTrace("INVESTIGATOR"), { timestamp: now(), agent: "INVESTIGATOR", event: "HYPOTHESIS_CREATED", summary: agents.investigator.rationale, tool: agents.investigator.selectedTool ?? undefined, evidenceRefs: agents.investigator.evidenceRefs, source: agents.investigator.source }, ...onDemandTrace("SKEPTIC"), { timestamp: now(), agent: "SKEPTIC", event: "CHALLENGE_CREATED", summary: agents.skeptic.challenge, tool: agents.skeptic.selectedTool ?? undefined, evidenceRefs: agents.skeptic.evidenceRefs, source: agents.skeptic.source }];
  const artifact = { workflowId: "event-transaction-investigation" as const, analysis, observerFindings, investigator: agents.investigator, skeptic: agents.skeptic, evidence, onDemandEvidence, trace, technicalTrace: { toolCalls: evidence.length + onDemandEvidence.length, llmCalls: agents.llmCalls, bounded: true as const, causality: "NOT_ESTABLISHED" as const, agentCalls: agents.agentCalls } };
  const validation = validateEventTransactionArtifact(input.dataset, artifact); if (validation.status !== "VALIDATED") throw new Error(`Event validation blocked finalization: ${validation.checks.filter((item) => !item.passed).map((item) => item.id).join(", ")}`); assertPublishableEventResult(artifact, validation);
  input.onProgress?.({ stage: "VERDICT_READY", source: "DETERMINISTIC", detail: "Independent validator recomputed the event artifact; final publication is allowed." });
  return { kind: "EVENT_TRANSACTION", artifact, validation };
}
