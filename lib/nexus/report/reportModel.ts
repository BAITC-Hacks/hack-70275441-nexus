import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { AgenticResult } from "@/lib/nexus/agentic/types";
import { buildBusinessSummary } from "./businessSummary.ts";
import { displayLabel, displayDomainLabel, relabelEvidenceSummary, relabelDomainEvidenceSummary } from "./displayLabels.ts";

const METHODOLOGY_NOTE =
  "NEXUS формирует и проверяет причинные гипотезы на основании наблюдаемых данных. " +
  "Корреляция и временная последовательность сами по себе не доказывают причинность. " +
  "Причинно-следственная связь считается гипотезой, а не установленным фактом.";

export interface ReportEvidenceEntry {
  id: string;
  /** Human-readable variable label(s), e.g. "Совокупный риск кредитного портфеля ↔ Кредитный риск". */
  variableLabel: string;
  /** The tool-output sentence with its leading canonical ID(s) relabeled for display. */
  resultSummary: string;
  /** Kept canonical on purpose — provenance information, not a business-facing label. */
  tool: string;
}

export interface InvestigationReportModel {
  generatedAt: string;
  objective: string;
  datasetName: string;
  headline: string;
  whyItMatters: string;
  findings: string[];
  /** Risk Chain steps in sequence, already display-labeled — empty when no chain was computed. */
  riskChainSteps: string[];
  hypothesis: { primary: string; alternative: string };
  skeptic: { status: AgenticResult["skepticReview"]["status"]; challenge: string; alternatives: string[]; revised: boolean };
  evidence: ReportEvidenceEntry[];
  nextSteps: string[];
  limitations: string[];
  causality: "NOT_ESTABLISHED";
  methodologyNote: string;
}

/**
 * Assembles the printable report from the investigation result that already exists in the browser —
 * it re-derives display text from already-computed values only. It does not call an LLM or any API,
 * does not recompute a single statistic, and does not mutate `analysis`/`agentic` (every field below is
 * a fresh string/array built from their values, never a reference back into the source objects).
 */
export function buildInvestigationReportModel(
  analysis: GenericAnalysis,
  agentic: AgenticResult,
  objective: string,
  datasetName: string,
  domainId?: string,
): InvestigationReportModel {
  const label = (id: string) => (domainId ? displayDomainLabel(id, domainId) : displayLabel(id));
  const relabel = (text: string) => (domainId ? relabelDomainEvidenceSummary(text, domainId) : relabelEvidenceSummary(text));

  const summary = buildBusinessSummary(analysis, agentic, domainId);
  const chain = agentic.precursorChain;
  const riskChainSteps = chain.edges.length
    ? [...chain.edges.map((edge) => edge.from), chain.edges[0].to].map(label)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    objective: objective.trim(),
    datasetName,
    headline: summary.headline,
    whyItMatters: summary.whyItMatters,
    findings: [...summary.findings],
    riskChainSteps,
    hypothesis: { primary: agentic.hypothesis.primary, alternative: agentic.hypothesis.alternative },
    skeptic: {
      status: agentic.skepticReview.status,
      challenge: agentic.skepticReview.challenge,
      alternatives: [...agentic.skepticReview.alternatives],
      revised: agentic.hypothesis.revised,
    },
    evidence: agentic.evidence.map((item) => ({
      id: item.id,
      variableLabel: item.variables.map(label).join(" ↔ ") || "DATASET",
      resultSummary: relabel(item.result),
      tool: item.tool,
    })),
    nextSteps: [...agentic.nextSteps],
    limitations: [...agentic.hypothesis.limitations],
    causality: "NOT_ESTABLISHED",
    methodologyNote: METHODOLOGY_NOTE,
  };
}

/** `NEXUS_Investigation_Report_YYYY-MM-DD.pdf` — a filesystem-safe name with no user-controlled characters. */
export function reportFileName(generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  return `NEXUS_Investigation_Report_${date}.pdf`;
}
