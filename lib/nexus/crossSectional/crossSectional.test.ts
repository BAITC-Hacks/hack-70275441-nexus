import { test } from "node:test";
import assert from "node:assert/strict";
import { admitInvestigation, executeAdmitted } from "../universal/admission.ts";
import { bankClients, bankFixtureMetadata } from "../universal/fixtures.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { containsAuthoritativeMetric, runCrossSectionalAgents, type CrossSectionalAgentRuns } from "./agents.ts";
import { fixtureMetadataFor } from "./metadata.ts";
import { analyzeCrossSectional, calculateAssociations, identifyHighRiskEntities, resolveTarget, summarizeCategoricalColumns, summarizeNumericColumns } from "./tools.ts";
import { publishedArtifactMatches, validateCrossSectionalArtifact } from "./validator.ts";
import { runCrossSectionalInvestigation } from "./workflow.ts";

const fallbackAgents = async (_analysis: unknown, evidence: Array<{ id: string }>): Promise<CrossSectionalAgentRuns> => ({
  llmCalls: 0,
  agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "calculate_cross_sectional_associations", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Target construction or confounding may explain the pattern.", rationale: "Interpretation is restricted to deterministic Evidence.", evidenceRefs: [evidence.find((item) => item.id === "E-004")!.id] },
  skeptic: { source: "FALLBACK", selectedTool: "inspect_target_provenance", status: "CHALLENGED", challenge: "The supplied score reuses inspected predictors, so the association may be circular and is not causal.", alternativeExplanation: "Score construction, subgroup size and confounding remain plausible.", evidenceRefs: [evidence.find((item) => item.id === "E-007")!.id] },
});
const ambiguous: UploadedDataset = { name: "values.csv", columns: ["value"], rows: [{ value: 1 }, { value: 2 }, { value: 3 }] };
const events: UploadedDataset = { name: "events.csv", columns: ["event_id", "timestamp", "action", "bytes"], rows: [1, 2, 3].map((i) => ({ event_id: `E${i}`, timestamp: `2026-01-0${i}`, action: "login", bytes: i })) };

test("bank fixture routes to the dedicated cross-sectional investigation", () => {
  const route = admitInvestigation({ dataset: bankClients, signals: ["risk_score"], intent: "INVESTIGATE" });
  assert.equal(route.status, "PROCEED"); assert.equal(route.shape.tag, "CROSS_SECTIONAL"); assert.equal(route.workflowId, "cross-sectional-investigation");
});

test("bank fixture cannot call the time-series execution boundary", () => {
  let calls = 0;
  assert.throws(() => executeAdmitted({ dataset: bankClients, signals: ["risk_score"] }, () => { calls += 1; }));
  assert.equal(calls, 0);
});

test("numeric summaries are deterministic and source-derived", () => {
  const first = summarizeNumericColumns(bankClients), second = summarizeNumericColumns(bankClients);
  assert.deepEqual(first, second);
  assert.deepEqual(first.find((item) => item.column === "DTI"), { column: "DTI", count: 12, missing: 0, min: 0.18, max: 0.64, mean: 0.4025, median: 0.4, standardDeviation: 0.137727085208 });
});

test("segment counts are exact", () => {
  const categories = summarizeCategoricalColumns(bankClients);
  assert.deepEqual(categories.find((item) => item.column === "region")?.values, [{ value: "Central", count: 4 }, { value: "North", count: 4 }, { value: "South", count: 4 }]);
  assert.equal(categories.find((item) => item.column === "risk_category")?.values.reduce((sum, item) => sum + item.count, 0), 12);
});

test("target associations and ordering are deterministic", () => {
  const target = resolveTarget(bankClients, "risk_score"); const first = calculateAssociations(bankClients, target);
  assert.deepEqual(first, calculateAssociations(bankClients, target));
  assert.equal(first[0].method, "PEARSON"); assert.equal(first[0].target, "risk_score"); assert.equal(first[0].causality, "NOT_ESTABLISHED");
});

test("high-risk selection uses supplied target quartile with stable row provenance", () => {
  const selected = identifyHighRiskEntities(bankClients, resolveTarget(bankClients, "risk_score"));
  assert.equal(selected.entities.length, 4); assert.deepEqual(selected.entities.map((item) => item.entityId), ["C-012", "C-011", "C-010", "C-009"]);
  assert.deepEqual(selected.entities.map((item) => item.sourceRow), [12, 11, 10, 9]); assert.ok(selected.entities.every((item) => item.evidenceRefs.includes("E-005")));
});

test("agent narrative schema has no numerical authority and numerical prose is rejected", async () => {
  assert.equal(containsAuthoritativeMetric({ hypothesis: "risk equals 99 percent", evidenceRefs: ["E-004"] }), true);
  const output = (await fallbackAgents({}, [{ id: "E-004" }, { id: "E-007" }])).investigator;
  assert.equal(containsAuthoritativeMetric(output), false); assert.equal(Object.values(output).some((value) => typeof value === "number"), false);
});

test("validator independently recomputes and accepts the completed artifact", async () => {
  const result = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, fallbackAgents);
  assert.equal(result.validation.status, "VALIDATED"); assert.ok(result.validation.checks.every((check) => check.passed)); assert.equal(publishedArtifactMatches(result.artifact, result.validation), true);
  assert.ok(result.artifact.evidence.every((item) => !/lag|directional|precursor/i.test(item.tool)));
});

test("deterministic artifact survives unavailable OpenAI with explicit FALLBACK labels", async () => {
  const previous = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const result = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" });
    assert.equal(result.validation.status, "VALIDATED"); assert.equal(result.artifact.investigator.source, "FALLBACK"); assert.equal(result.artifact.skeptic.source, "FALLBACK"); assert.equal(result.artifact.technicalTrace.llmCalls, 0);
    assert.deepEqual(result.artifact.technicalTrace.agentCalls.map((call) => call.fallbackReason), ["MISSING_API_KEY", "MISSING_API_KEY"]);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test("a real live tool call's on-demand Evidence still validates end to end (VALIDATED, publishable, correct id)", async () => {
  const liveToolRunner = (analysis: Parameters<typeof runCrossSectionalAgents>[0], evidence: Parameters<typeof runCrossSectionalAgents>[1], metadata?: Parameters<typeof runCrossSectionalAgents>[2], objective?: string) => {
    let calls = 0;
    const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
      if (role === "SKEPTIC") return JSON.stringify({ selectedTool: "inspect_target_provenance", status: "CHALLENGED", challenge: "The supplied target may reuse predictors, creating leakage without proving causality.", alternativeExplanation: "Confounding and selection effects remain plausible.", evidenceRefs: ["E-004", "E-007"] });
      calls += 1;
      if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "summarize_numeric_columns", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
      return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Confounding may explain the pattern.", rationale: "Grounded in the freshly revealed numeric summary.", evidenceRefs: ["E-008"] });
    };
    return runCrossSectionalAgents(analysis, evidence, metadata, objective, { request });
  };
  const result = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, liveToolRunner);
  assert.equal(result.validation.status, "VALIDATED");
  assert.ok(result.validation.checks.find((check) => check.id === "ON_DEMAND_EVIDENCE_REPRODUCIBLE")?.passed);
  assert.equal(result.artifact.onDemandEvidence.length, 1);
  assert.equal(result.artifact.onDemandEvidence[0].id, "E-008");
  assert.equal(publishedArtifactMatches(result.artifact, result.validation), true);
});

test("a tampered on-demand Evidence record is caught by ON_DEMAND_EVIDENCE_REPRODUCIBLE without touching any other check", async () => {
  const liveToolRunner = (analysis: Parameters<typeof runCrossSectionalAgents>[0], evidence: Parameters<typeof runCrossSectionalAgents>[1], metadata?: Parameters<typeof runCrossSectionalAgents>[2], objective?: string) => {
    let calls = 0;
    const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
      if (role === "SKEPTIC") return JSON.stringify({ selectedTool: "inspect_target_provenance", status: "CHALLENGED", challenge: "The supplied target may reuse predictors, creating leakage without proving causality.", alternativeExplanation: "Confounding and selection effects remain plausible.", evidenceRefs: ["E-004", "E-007"] });
      calls += 1;
      if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "summarize_numeric_columns", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
      return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "summarize_numeric_columns", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Confounding may explain the pattern.", rationale: "Grounded in the freshly revealed numeric summary.", evidenceRefs: ["E-008"] });
    };
    return runCrossSectionalAgents(analysis, evidence, metadata, objective, { request });
  };
  const result = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, liveToolRunner);
  const tampered = structuredClone(result.artifact);
  tampered.onDemandEvidence[0].result = "A fabricated summary that was never actually computed.";
  const validation = validateCrossSectionalArtifact(bankClients, tampered, "risk_score", bankFixtureMetadata);
  assert.equal(validation.status, "BLOCKED");
  assert.equal(validation.checks.find((check) => check.id === "ON_DEMAND_EVIDENCE_REPRODUCIBLE")?.passed, false);
  assert.ok(validation.checks.filter((check) => check.id !== "ON_DEMAND_EVIDENCE_REPRODUCIBLE").every((check) => check.passed), "tampering only the on-demand record must not fail unrelated baseline checks");
});

test("tampered deterministic metric fails validation and publication hash", async () => {
  const result = await runCrossSectionalInvestigation({ dataset: bankClients, signals: ["risk_score"], target: "risk_score" }, fallbackAgents);
  const tampered = structuredClone(result.artifact); tampered.analysis.numericSummaries[0].mean += 1;
  const validation = validateCrossSectionalArtifact(bankClients, tampered, "risk_score", bankFixtureMetadata);
  assert.equal(validation.status, "BLOCKED"); assert.equal(validation.checks.find((check) => check.id === "NUMERIC_SUMMARIES")?.passed, false);
  assert.equal(publishedArtifactMatches(tampered, result.validation), false);
});

test("no confirmed target preserves descriptive analysis without supervised claims", () => {
  const dataset = { ...bankClients, name: "entities.csv", columns: bankClients.columns.filter((column) => !["risk_score", "risk_category"].includes(column)), rows: bankClients.rows.map(({ risk_score: _score, risk_category: _category, ...row }) => row) };
  const analysis = analyzeCrossSectional(dataset);
  assert.equal(analysis.target.authoritative, false); assert.equal(analysis.associations.length, 0); assert.ok(analysis.numericSummaries.length > 0); assert.equal(analysis.highRisk.entities.length, 0);
});

test("categorical target uses numeric group comparisons and contingency counts", () => {
  const analysis = analyzeCrossSectional(bankClients, "risk_category", bankFixtureMetadata);
  assert.ok(analysis.associations.some((item) => item.method === "NUMERIC_BY_TARGET_GROUP"));
  assert.ok(analysis.associations.some((item) => item.method === "CONTINGENCY"));
  assert.ok(analysis.associations.every((item) => item.causality === "NOT_ESTABLISHED"));
});

test("prepared score provenance is accepted only when its formula matches", () => {
  assert.deepEqual(fixtureMetadataFor(bankClients), bankFixtureMetadata);
  const changed = structuredClone(bankClients); changed.rows[0].risk_score = Number(changed.rows[0].risk_score) + 1;
  assert.equal(fixtureMetadataFor(changed), undefined);
});

test("ambiguous data remains blocked and event data cannot enter time-series execution while valid time series remains unchanged", () => {
  assert.equal(admitInvestigation({ dataset: ambiguous, signals: ["value"] }).status, "NEEDS_INPUT");
  assert.equal(admitInvestigation({ dataset: events, signals: ["bytes"] }).workflowId, "event-transaction-investigation");
  assert.throws(() => executeAdmitted({ dataset: events, signals: ["bytes"] }, () => assert.fail("event execution must remain blocked")));
  const temporal = fintechDemoDataset(); const route = admitInvestigation({ dataset: temporal, signals: ["cash_flow"] }); let calls = 0;
  assert.equal(route.workflowId, "generic-time-series-investigation"); executeAdmitted({ dataset: temporal, signals: ["cash_flow"] }, () => { calls += 1; }); assert.equal(calls, 1);
});
