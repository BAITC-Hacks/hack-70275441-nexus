import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvestigationReportModel, reportFileName } from "./reportModel.ts";
import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { AgenticResult } from "@/lib/nexus/agentic/types";

const analysis = {
  findings: [
    { column: "default_risk", latest: 4.3, mean: 2, standardDeviation: 1, zScore: 2.1, observationCount: 24, missingPercent: 0, direction: "rising" as const },
  ],
} as unknown as GenericAnalysis;

function buildAgentic(overrides: Partial<AgenticResult> = {}): AgenticResult {
  return {
    observerFindings: ["default_risk: 5/5 recent adjacent movements were non-decreasing."],
    hypothesis: { primary: "Credit risk appears to lead portfolio risk in this window.", alternative: "Seasonality could explain part of the movement.", supportingEvidence: ["E-001", "E-002"], limitations: ["Directional evidence only covers a short recent window."], revised: false },
    skepticReview: { status: "SUPPORTED", challenge: "Checked whether liquidity stress alone explains the pattern.", alternatives: ["Reporting timing differences were not ruled out."], evidenceRefs: ["E-003"] },
    finalAssessment: "The candidate explanation survived the configured challenge pass.",
    evidence: [
      { id: "E-001", tool: "inspect_directional_movement", variables: ["default_risk"], result: "default_risk: 5/5 recent adjacent movements were non-decreasing.", data: {}, usedBy: ["OBSERVER"] },
      { id: "E-004", tool: "calculate_correlation", variables: ["portfolio_risk", "default_risk"], result: "portfolio_risk ↔ default_risk: correlation 0.998 over 24 paired observations.", data: {}, usedBy: ["INVESTIGATOR"] },
    ],
    trace: [],
    executionStats: { agentSteps: 4, toolCalls: 2, llmCalls: 2, revisionRounds: 0, executionLimitReached: false },
    precursorChain: {
      edges: [{ from: "default_risk", to: "portfolio_risk", correlation: 0.998, lagPeriods: 0, n: 24, ci95: { lower: 0.99, upper: 1 }, pValue: 0.0001, significant: true, allLags: [], bootstrap: null }],
      riskIndicator: 0.8,
      riskLabel: "HIGH",
      causality: "NOT_ESTABLISHED",
      methodologyNotes: [],
    },
    nextSteps: ["Prioritize human review of Кредитный риск — it carries the strongest computed association with the outcome, but correlation is not confirmed causation."],
    timings: { profiling: 1, observer: 1, investigatorLlm: [], investigatorTool: [], skepticLlm: [], skepticTool: [], total: 1 },
    investigator: { source: "LLM", toolCalls: 1, latencies: [] },
    skeptic: { source: "LLM", toolCalls: 1, latencies: [] },
    ...overrides,
  } as AgenticResult;
}

test("the report model reuses the existing business summary and never leaks a canonical field ID into business-facing text", () => {
  const report = buildInvestigationReportModel(analysis, buildAgentic(), "Investigate rising credit risk.", "portfolio_risk_monitor.csv");
  assert.equal(report.objective, "Investigate rising credit risk.");
  assert.match(report.headline, /Совокупный риск кредитного портфеля|Кредитный риск/);
  assert.doesNotMatch(report.headline, /\bdefault_risk\b|\bportfolio_risk\b/);
  assert.doesNotMatch(report.findings.join(" "), /\bdefault_risk\b|\bportfolio_risk\b/);
});

test("the risk chain steps are the same display-labeled sequence Risk Chain renders, not canonical IDs", () => {
  const report = buildInvestigationReportModel(analysis, buildAgentic(), "", "fixture.csv");
  assert.deepEqual(report.riskChainSteps, ["Кредитный риск", "Совокупный риск кредитного портфеля"]);
});

test("evidence entries keep their Evidence ID and tool name canonical, but relabel the variable and result text", () => {
  const report = buildInvestigationReportModel(analysis, buildAgentic(), "", "fixture.csv");
  const pairEvidence = report.evidence.find((item) => item.id === "E-004")!;
  assert.equal(pairEvidence.tool, "calculate_correlation");
  assert.equal(pairEvidence.variableLabel, "Совокупный риск кредитного портфеля ↔ Кредитный риск");
  assert.equal(pairEvidence.resultSummary, "Совокупный риск кредитного портфеля ↔ Кредитный риск: корреляция 0,998 по 24 парным наблюдениям.");
  assert.equal(report.evidence[0].id, "E-001", "Evidence IDs must keep their canonical E-00N form and order");
});

test("hypothesis, skeptic and nextSteps are passed through as-is from the existing investigation result — no re-analysis", () => {
  const agentic = buildAgentic();
  const report = buildInvestigationReportModel(analysis, agentic, "", "fixture.csv");
  assert.equal(report.hypothesis.primary, agentic.hypothesis.primary);
  assert.equal(report.skeptic.challenge, agentic.skepticReview.challenge);
  assert.equal(report.skeptic.status, "SUPPORTED");
  assert.deepEqual(report.nextSteps, agentic.nextSteps);
  assert.deepEqual(report.limitations, agentic.hypothesis.limitations);
});

test("causality is always reported as NOT_ESTABLISHED and the fixed methodology disclaimer never claims proven causation", () => {
  const report = buildInvestigationReportModel(analysis, buildAgentic(), "", "fixture.csv");
  assert.equal(report.causality, "NOT_ESTABLISHED");
  assert.match(report.methodologyNote, /не доказывают причинность/);
  assert.match(report.methodologyNote, /считается гипотезой, а не установленным фактом/);
});

test("building the report model does not mutate the source analysis or agentic objects", () => {
  const agentic = buildAgentic();
  const snapshotEvidenceLength = agentic.evidence.length;
  const snapshotFirstResult = agentic.evidence[0].result;
  const snapshotLimitations = [...agentic.hypothesis.limitations];
  buildInvestigationReportModel(analysis, agentic, "objective", "fixture.csv");
  assert.equal(agentic.evidence.length, snapshotEvidenceLength);
  assert.equal(agentic.evidence[0].result, snapshotFirstResult, "the raw EvidenceRecord.result must be untouched");
  assert.deepEqual(agentic.hypothesis.limitations, snapshotLimitations);
});

test("optional/empty fields (no objective, no chain, no evidence, no limitations, no alternatives) are handled without throwing", () => {
  const emptyAgentic = buildAgentic({
    precursorChain: { edges: [], riskIndicator: 0, riskLabel: "LOW", causality: "NOT_ESTABLISHED", methodologyNotes: [] },
    evidence: [],
    hypothesis: { primary: "No candidate hypothesis was formed.", alternative: "", supportingEvidence: [], limitations: [], revised: false },
    skepticReview: { status: "INCONCLUSIVE", challenge: "No challenge was run.", alternatives: [], evidenceRefs: [] },
    nextSteps: [],
  });
  const report = buildInvestigationReportModel({ findings: [] } as unknown as GenericAnalysis, emptyAgentic, "", "fixture.csv");
  assert.equal(report.objective, "");
  assert.deepEqual(report.riskChainSteps, []);
  assert.deepEqual(report.evidence, []);
  assert.deepEqual(report.limitations, []);
  assert.deepEqual(report.skeptic.alternatives, []);
});

test("reportFileName produces the universal NEXUS_Investigation_Report_YYYY-MM-DD.pdf shape", () => {
  assert.equal(reportFileName("2026-09-10T12:34:56.000Z"), "NEXUS_Investigation_Report_2026-09-10.pdf");
});

test("passing a domainId resolves canonical IDs through the Domain Registry in the PDF report, not the generic prettified fallback", () => {
  const logisticsAnalysis = {
    findings: [{ column: "fuel_cost", latest: 520, mean: 480, standardDeviation: 10, zScore: 2.5, observationCount: 24, missingPercent: 0, direction: "rising" as const }],
  } as unknown as GenericAnalysis;
  const logisticsAgentic = buildAgentic({
    observerFindings: ["on_time_delivery_rate: 0/5 recent adjacent movements were non-decreasing."],
    evidence: [
      { id: "E-001", tool: "inspect_directional_movement", variables: ["on_time_delivery_rate"], result: "on_time_delivery_rate: 0/5 recent adjacent movements were non-decreasing.", data: {}, usedBy: ["OBSERVER"] },
      { id: "E-004", tool: "calculate_correlation", variables: ["delivery_delay", "fuel_cost"], result: "delivery_delay ↔ fuel_cost: correlation 0.91 over 22 paired observations.", data: {}, usedBy: ["INVESTIGATOR"] },
    ],
    precursorChain: {
      edges: [{ from: "fuel_cost", to: "delivery_delay", correlation: 0.91, lagPeriods: 2, n: 22, ci95: { lower: 0.8, upper: 0.96 }, pValue: 0.0002, significant: true, allLags: [], bootstrap: null }],
      riskIndicator: 0.7,
      riskLabel: "HIGH",
      causality: "NOT_ESTABLISHED",
      methodologyNotes: [],
    },
  });
  const report = buildInvestigationReportModel(logisticsAnalysis, logisticsAgentic, "", "fixture.csv", "LOGISTICS");
  assert.deepEqual(report.riskChainSteps, ["Стоимость топлива", "Задержка доставки"]);
  const pairEvidence = report.evidence.find((item) => item.id === "E-004")!;
  assert.equal(pairEvidence.variableLabel, "Задержка доставки ↔ Стоимость топлива");
  assert.match(pairEvidence.resultSummary, /Задержка доставки ↔ Стоимость топлива: корреляция 0,91/);
  const singleEvidence = report.evidence.find((item) => item.id === "E-001")!;
  assert.equal(singleEvidence.resultSummary, "Доля своевременных поставок: 0 из 5 последних смежных изменений были неснижающимися.");
  const joined = `${report.headline} ${report.findings.join(" ")} ${report.riskChainSteps.join(" ")}`;
  assert.doesNotMatch(joined, /\bfuel_cost\b|\bdelivery_delay\b|\bon_time_delivery_rate\b|Fuel cost|Delivery delay|On time delivery rate/);
});
