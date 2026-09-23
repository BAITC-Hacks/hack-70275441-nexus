import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import type { CrossSectionalAgentRuns } from "../crossSectional/agents.ts";
import { entityColumn, resolveTarget } from "../crossSectional/tools.ts";
import { admitInvestigation, executeAdmitted } from "./admission.ts";
import { bankClients, russianBankClients60 } from "./fixtures.ts";
import { findColumnByRole, normalizeHeader } from "./headers.ts";
import { profileShape } from "./profile.ts";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import type { UploadedDataset } from "../ingestion/types.ts";

const fallbackAgents = async (_analysis: unknown, evidence: Array<{ id: string }>): Promise<CrossSectionalAgentRuns> => ({
  llmCalls: 0,
  agentCalls: [],
  investigator: { source: "FALLBACK", selectedTool: "calculate_cross_sectional_associations", hypothesis: "Observed attributes are associated with the supplied target.", alternativeExplanation: "Confounding may explain the pattern.", rationale: "Interpretation uses deterministic Evidence.", evidenceRefs: [evidence.find((item) => item.id === "E-004")!.id] },
  skeptic: { source: "FALLBACK", selectedTool: "compare_delinquency_segment", status: "CHALLENGED", challenge: "Target construction and confounding remain possible; association is not causal.", alternativeExplanation: "Independent outcomes and larger groups are required.", evidenceRefs: [evidence.find((item) => item.id === "E-006")!.id] },
});

test("localized header normalization preserves display name and recognizes entity aliases", () => {
  assert.deepEqual(normalizeHeader("  ID   клиента  "), { originalName: "  ID   клиента  ", normalizedName: "id клиента", semanticRole: "ENTITY_ID" });
  assert.equal(normalizeHeader("Идентификатор клиента").semanticRole, "ENTITY_ID");
  assert.equal(entityColumn(russianBankClients60), "ID клиента");
});

test("hyphen, punctuation, unit and Cyrillic target aliases normalize deterministically", () => {
  assert.equal(normalizeHeader(" РИСК–БАЛЛ ").normalizedName, "риск балл");
  assert.equal(normalizeHeader("Риск-балл").semanticRole, "TARGET_NUMERIC");
  assert.equal(normalizeHeader("Категория риска").semanticRole, "TARGET_CATEGORY");
  assert.equal(normalizeHeader("DTI, %").semanticRole, "DTI");
  assert.equal(normalizeHeader("Кредитный рейтинг (300–850)").semanticRole, "CREDIT_RATING");
  assert.equal(normalizeHeader("Просрочек за 12 мес (шт)").semanticRole, "DELINQUENCIES_12M");
  assert.equal(normalizeHeader("Просрочка текущая (дней)").semanticRole, "CURRENT_DELINQUENCY");
});

test("real 60-row Russian schema is cross-sectional and needs no time column", () => {
  const shape = profileShape(russianBankClients60);
  assert.equal(shape.tag, "CROSS_SECTIONAL"); assert.equal(shape.timeColumn, undefined); assert.deepEqual(shape.missingRequirements, []);
});

test("Russian risk score resolves as numeric target and risk category remains discoverable", () => {
  assert.deepEqual(resolveTarget(russianBankClients60), { column: "Риск-балл", source: "KNOWN_ALIAS", kind: "NUMERIC", authoritative: true, reason: "Target matched the safe known alias Риск-балл." });
  assert.equal(findColumnByRole(russianBankClients60.columns, "TARGET_CATEGORY"), "Категория риска");
});

test("real Russian schema route preview and API admission contract both PROCEED cross-sectionally", () => {
  const request = { dataset: russianBankClients60, signals: ["Возраст", "DTI, %"], intent: "INVESTIGATE" };
  const route = admitInvestigation(request);
  assert.equal(route.status, "PROCEED"); assert.equal(route.workflowId, "cross-sectional-investigation"); assert.ok(!route.missingRequirements.some((item) => /time|period|ISO/i.test(item)));
  const workspace = readFileSync(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8");
  assert.match(workspace, /const routeDecision = useMemo\(\(\) => dataset \? admitInvestigation\(/); assert.doesNotMatch(workspace, /profileShape\(dataset/);
  assert.match(workspace, /findColumnByRole\(next\.columns, "TARGET_NUMERIC"\)/); assert.match(api, /const routeDecision = admitInvestigation\(admissionRequest\)/);
});

test("Russian cross-sectional workflow validates without any temporal tool", async () => {
  const result = await runCrossSectionalInvestigation({ dataset: russianBankClients60, signals: ["Возраст", "DTI, %"], target: "Риск-балл" }, fallbackAgents);
  assert.equal(result.validation.status, "VALIDATED"); assert.equal(result.artifact.analysis.dataset.entityCount, 60); assert.equal(result.artifact.analysis.target.column, "Риск-балл");
  assert.equal(result.artifact.analysis.delinquencyPrevalence.column, "Просрочка текущая (дней)|Просрочек за 12 мес (шт)");
  assert.ok(result.artifact.evidence.every((item) => !/inspect_series|inspect_directional_movement|build_precursor_chain|\blag\b/i.test(`${item.tool} ${item.result}`)));
  assert.throws(() => executeAdmitted({ dataset: russianBankClients60, signals: ["Возраст"] }, () => assert.fail("time-series boundary must not execute")));
});

test("English cross-section, time series, event and ambiguous routing regressions remain intact", () => {
  assert.equal(admitInvestigation({ dataset: bankClients, signals: ["risk_score"] }).workflowId, "cross-sectional-investigation");
  const temporal = fintechDemoDataset(); assert.equal(admitInvestigation({ dataset: temporal, signals: ["cash_flow"] }).workflowId, "generic-time-series-investigation");
  const events: UploadedDataset = { name: "events.csv", columns: ["event_id", "timestamp", "action", "bytes"], rows: [1, 2, 3].map((i) => ({ event_id: `E${i}`, timestamp: `2026-01-0${i}`, action: "login", bytes: i })) };
  const ambiguous: UploadedDataset = { name: "numbers.csv", columns: ["value"], rows: [{ value: 1 }, { value: 2 }, { value: 3 }] };
  assert.equal(admitInvestigation({ dataset: events, signals: ["bytes"] }).workflowId, "event-transaction-investigation"); assert.equal(admitInvestigation({ dataset: ambiguous, signals: ["value"] }).status, "NEEDS_INPUT");
});
