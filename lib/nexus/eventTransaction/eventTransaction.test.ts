import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fintechDemoDataset } from "../demo/fintechDataset.ts";
import type { UploadedDataset } from "../ingestion/types.ts";
import { admitInvestigation, executeAdmitted } from "../universal/admission.ts";
import { eventActivityFixture, russianBankClients60 } from "../universal/fixtures.ts";
import { normalizeHeader } from "../universal/headers.ts";
import { runCrossSectionalInvestigation } from "../crossSectional/workflow.ts";
import { containsEventMetric, runEventAgents, type EventAgentRuns } from "./agents.ts";
import { buildEventTransactionEvidence } from "./evidence.ts";
import { analyzeEventTransactions, detectBursts, detectRepeatedPatterns, groupRelatedEvents, inspectEntityActivity, inspectEventRecord, normalizeEvents } from "./tools.ts";
import { publishedEventArtifactMatches, validateEventTransactionArtifact } from "./validator.ts";
import { runEventTransactionInvestigation } from "./workflow.ts";

const fallbackAgents = async (_analysis: unknown, evidence: Array<{ id: string }>): Promise<EventAgentRuns> => ({ llmCalls: 0, agentCalls: [], investigator: { source: "FALLBACK", selectedTool: "inspect_entity_activity", hypothesis: "A subset of activity warrants review under deterministic rules.", alternativeExplanation: "Benign batching or retries may explain the concentration.", rationale: "Interpretation uses Evidence references only.", evidenceRefs: [evidence.find((item) => item.id === "E-007")!.id] }, skeptic: { source: "FALLBACK", selectedTool: "summarize_event_timing", status: "CHALLENGED", challenge: "Duplication, timestamp quality and a limited baseline may explain the pattern.", alternativeExplanation: "Normal automation remains plausible.", evidenceRefs: [evidence.find((item) => item.id === "E-004")!.id] } });
const investigatorJson = JSON.stringify({ selectedTool: "inspect_entity_activity", hypothesis: "A subset of entity activity warrants review under published rules.", alternativeExplanation: "Benign batching or retries may explain the concentration.", rationale: "The interpretation is limited to cited Evidence.", evidenceRefs: ["E-007"] });
const skepticJson = JSON.stringify({ selectedTool: "summarize_event_timing", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "Duplication, collection artifacts, timestamp quality and a limited baseline remain plausible.", alternativeExplanation: "Normal automation or batch processing may explain the pattern.", evidenceRefs: ["E-004", "E-007"] });
const ambiguous: UploadedDataset = { name: "values.csv", columns: ["value"], rows: [{ value: 1 }, { value: 2 }, { value: 3 }] };

test("event semantic roles preserve original display names and include localized aliases", () => {
  assert.deepEqual(normalizeHeader("ID события"), { originalName: "ID события", normalizedName: "id события", semanticRole: "EVENT_ID" });
  assert.equal(normalizeHeader("Дата транзакции").semanticRole, "EVENT_TIMESTAMP");
  assert.equal(normalizeHeader("ID пользователя").semanticRole, "ENTITY_ID");
  assert.equal(normalizeHeader("Тип события").semanticRole, "EVENT_TYPE");
  assert.equal(normalizeHeader("Сумма").semanticRole, "EVENT_VALUE");
  assert.equal(normalizeHeader("Категория риска").semanticRole, "TARGET_CATEGORY");
});

test("valid generic events route by shape and intent to event transaction investigation", () => {
  const route = admitInvestigation({ dataset: eventActivityFixture, signals: ["amount"], intent: "INVESTIGATE" });
  assert.equal(route.shape.tag, "EVENT_TRANSACTION"); assert.equal(route.status, "PROCEED"); assert.equal(route.workflowId, "event-transaction-investigation");
});

test("banking, machine and user logs use the same domain-neutral workflow", () => {
  const variants = [
    { ...eventActivityFixture, name: "banking.csv", columns: ["transaction_id", "transaction_time", "account_id", "transaction_type", "transaction_amount", "status"], rows: eventActivityFixture.rows.map((row) => ({ transaction_id: row.event_id, transaction_time: row.timestamp, account_id: row.entity_id, transaction_type: row.event_type, transaction_amount: row.amount, status: row.status })) },
    { ...eventActivityFixture, name: "machine.csv", columns: ["event_id", "event_time", "device_id", "event_type", "value", "status"], rows: eventActivityFixture.rows.map((row) => ({ event_id: row.event_id, event_time: row.timestamp, device_id: row.entity_id, event_type: row.event_type, value: row.amount, status: row.status })) },
    { ...eventActivityFixture, name: "users.csv", columns: ["event_id", "created_at", "user_id", "action", "value", "status"], rows: eventActivityFixture.rows.map((row) => ({ event_id: row.event_id, created_at: row.timestamp, user_id: row.entity_id, action: row.event_type, value: row.amount, status: row.status })) },
  ];
  assert.ok(variants.every((dataset) => admitInvestigation({ dataset, signals: [], intent: "INVESTIGATE" }).workflowId === "event-transaction-investigation"));
});

test("amount is optional and unknown tasks or intents remain unsupported", () => {
  const dataset: UploadedDataset = { name: "actions.csv", columns: ["event_id", "timestamp", "user_id", "action"], rows: eventActivityFixture.rows.slice(0, 5).map((row) => ({ event_id: row.event_id, timestamp: row.timestamp, user_id: row.entity_id, action: row.event_type })) };
  assert.equal(admitInvestigation({ dataset, signals: [] }).workflowId, "event-transaction-investigation");
  assert.equal(admitInvestigation({ dataset, signals: [], taskId: "cybersecurity" }).status, "UNSUPPORTED");
  assert.equal(admitInvestigation({ dataset, signals: [], intent: "SCORE" }).status, "UNSUPPORTED");
});

test("localized event headers are admitted and analyzed", () => {
  const dataset: UploadedDataset = { name: "события.csv", columns: ["ID события", "Дата события", "ID пользователя", "Тип события", "Сумма"], rows: eventActivityFixture.rows.map((row) => ({ "ID события": row.event_id, "Дата события": row.timestamp, "ID пользователя": row.entity_id, "Тип события": row.event_type, "Сумма": row.amount })) };
  const route = admitInvestigation({ dataset, signals: [] }), analysis = analyzeEventTransactions(dataset);
  assert.equal(route.shape.tag, "EVENT_TRANSACTION"); assert.equal(route.workflowId, "event-transaction-investigation"); assert.equal(analysis.semantics.eventIdColumn, "ID события"); assert.equal(analysis.dataset.eventCount, 30);
});

test("invalid event-like schema remains ambiguous and cannot enter event workflow", async () => {
  const invalid: UploadedDataset = { name: "invalid-events.csv", columns: ["event_id", "timestamp", "amount"], rows: [1, 2, 3].map((value) => ({ event_id: `E${value}`, timestamp: `2026-01-0${value}T00:00:00Z`, amount: value })) };
  assert.equal(admitInvestigation({ dataset: invalid, signals: ["amount"] }).status, "NEEDS_INPUT");
  await assert.rejects(() => runEventTransactionInvestigation({ dataset: invalid, signals: ["amount"] }, fallbackAgents));
});

test("prepared fixture counts and entity activity are exact", () => {
  const analysis = analyzeEventTransactions(eventActivityFixture);
  assert.equal(analysis.dataset.eventCount, 30); assert.equal(analysis.profile.uniqueEventIds, 30); assert.equal(analysis.profile.duplicateEventIds, 0); assert.equal(analysis.profile.uniqueEntities, 8);
  assert.equal(analysis.entityActivity[0].entityId, "ENTITY-HIGH-ACTIVITY"); assert.equal(analysis.entityActivity[0].eventCount, 8); assert.deepEqual(analysis.eventTypes.map((item) => [item.eventType, item.count]), [["payment", 12], ["view", 9], ["update", 8], ["manual_review", 1]]);
});

test("burst, rare-type, value-outlier and repeated-event detection are deterministic", () => {
  const first = analyzeEventTransactions(eventActivityFixture), second = analyzeEventTransactions(eventActivityFixture);
  assert.deepEqual(first, second); assert.equal(first.timing.burstWindowMs, 300_000); assert.equal(first.timing.bursts.length, 1); assert.equal(first.timing.bursts[0].eventIds.length, 8);
  assert.deepEqual(first.detection.rareEventTypes, ["manual_review"]); assert.deepEqual(first.detection.valueOutlierEventIds, ["EV-008"]); assert.equal(first.detection.repeatedPatterns.length, 1); assert.deepEqual(first.detection.repeatedPatterns[0].eventIds, ["EV-001", "EV-002", "EV-003"]);
});

test("event grouping is deterministic and preserves source rows", () => {
  const events = normalizeEvents(eventActivityFixture); assert.deepEqual(detectBursts(events), detectBursts(events)); assert.deepEqual(detectRepeatedPatterns(events), detectRepeatedPatterns(events)); assert.deepEqual(groupRelatedEvents(events), groupRelatedEvents(events));
  const cluster = groupRelatedEvents(events)[0]; assert.equal(cluster.id, "C-001"); assert.deepEqual(cluster.sourceRows, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(inspectEventRecord(eventActivityFixture, "EV-008")?.sourceRow, 8); assert.equal(inspectEntityActivity(analyzeEventTransactions(eventActivityFixture), "ENTITY-HIGH-ACTIVITY")?.notableEvents.length, 8);
});

test("event workflow validates and cannot execute time-series or cross-sectional paths", async () => {
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallbackAgents);
  assert.equal(result.validation.status, "VALIDATED"); assert.ok(result.validation.checks.every((item) => item.passed)); assert.equal(publishedEventArtifactMatches(result.artifact, result.validation), true);
  const tools = result.artifact.evidence.map((item) => item.tool); assert.ok(tools.every((tool) => !/series|directional|precursor|lag|cross_sectional|association/i.test(tool)));
  assert.throws(() => executeAdmitted({ dataset: eventActivityFixture, signals: ["amount"] }, () => assert.fail("time-series callback must not execute")));
  await assert.rejects(() => runCrossSectionalInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }));
});

test("agent narrative has no numerical authority and live responses select event capabilities", async () => {
  assert.equal(containsEventMetric({ hypothesis: "There are 99 events." }), true);
  const analysis = analyzeEventTransactions(eventActivityFixture), evidence = buildEventTransactionEvidence(analysis);
  const result = await runEventAgents(analysis, evidence, undefined, { request: async ({ role }) => role === "INVESTIGATOR" ? investigatorJson : skepticJson, model: "test-model" });
  assert.equal(result.investigator.source, "LLM"); assert.equal(result.investigator.selectedTool, "inspect_entity_activity"); assert.equal(result.skeptic.source, "LLM"); assert.deepEqual(result.agentCalls.map((item) => item.outcome), ["LIVE_AGENT", "LIVE_AGENT"]);
});

test("Investigator genuinely executes a live tool with a real entity ID and cites the resulting on-demand Evidence", async () => {
  const analysis = analyzeEventTransactions(eventActivityFixture), evidence = buildEventTransactionEvidence(analysis);
  let calls = 0;
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "SKEPTIC") return skepticJson;
    calls += 1;
    if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "inspect_entity_activity", id: "ENTITY-HIGH-ACTIVITY", selectedTool: "inspect_entity_activity", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
    return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "inspect_entity_activity", hypothesis: "A subset of entity activity warrants review under published rules.", alternativeExplanation: "Benign batching may explain the concentration.", rationale: "Grounded in the freshly looked-up entity record.", evidenceRefs: ["E-008"] });
  };
  const result = await runEventAgents(analysis, evidence, undefined, { request, dataset: eventActivityFixture });
  assert.equal(result.investigator.source, "LLM");
  assert.equal(result.onDemandEvidence?.length, 1);
  assert.equal(result.onDemandEvidence?.[0].id, "E-008");
  assert.equal(result.onDemandEvidence?.[0].tool, "inspect_entity_activity");
  assert.equal(result.onDemandEvidence?.[0].data.requestedId, "ENTITY-HIGH-ACTIVITY");
  assert.deepEqual(result.investigator.evidenceRefs, ["E-008"]);
});

test("an entity ID that is not part of the deterministic entity set is rejected without executing — falls back", async () => {
  const analysis = analyzeEventTransactions(eventActivityFixture), evidence = buildEventTransactionEvidence(analysis);
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => role === "SKEPTIC" ? skepticJson : JSON.stringify({ action: "CALL_TOOL", tool: "inspect_entity_activity", id: "GHOST-ENTITY", selectedTool: "inspect_entity_activity", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
  const result = await runEventAgents(analysis, evidence, undefined, { request, dataset: eventActivityFixture });
  assert.equal(result.investigator.source, "FALLBACK");
  assert.equal(result.agentCalls[0].fallbackReason, "INVALID_TOOL_CALL");
  assert.equal(result.onDemandEvidence?.length, 0);
});

test("Skeptic genuinely executes inspect_event_record with a real event ID, and the numeric-looking id never false-positives the numeric-authority guard", async () => {
  const analysis = analyzeEventTransactions(eventActivityFixture), evidence = buildEventTransactionEvidence(analysis);
  let skepticCalls = 0;
  const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
    if (role === "INVESTIGATOR") return investigatorJson;
    skepticCalls += 1;
    if (skepticCalls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "inspect_event_record", id: "EV-008", selectedTool: "inspect_event_record", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "interim", alternativeExplanation: "interim", evidenceRefs: [] });
    return JSON.stringify({ action: "FINAL_VERDICT", tool: "NONE", id: "NONE", selectedTool: "inspect_event_record", targetedAssumption: "Observed patterns remain meaningful after checking source quality.", status: "CHALLENGED", challenge: "Duplication, collection artifacts, timestamp quality and a limited baseline remain plausible.", alternativeExplanation: "Normal automation may explain the pattern.", evidenceRefs: ["E-004", "E-008"] });
  };
  const result = await runEventAgents(analysis, evidence, undefined, { request, dataset: eventActivityFixture });
  assert.equal(result.skeptic.source, "LLM");
  assert.equal(result.onDemandEvidence?.length, 1);
  assert.equal(result.onDemandEvidence?.[0].id, "E-008");
  assert.equal(result.onDemandEvidence?.[0].tool, "inspect_event_record");
  assert.equal(result.onDemandEvidence?.[0].data.requestedId, "EV-008");
  assert.doesNotMatch(result.skeptic.challenge, /\d/, "the terminal narrative itself must contain no digits, even though the on-demand id (EV-008) did");
});

test("a real live tool call's on-demand Evidence still validates end to end through the full workflow (VALIDATED, publishable, correct id)", async () => {
  const liveToolRunner = (analysis: Parameters<typeof runEventAgents>[0], evidence: Parameters<typeof runEventAgents>[1], objective?: string, options?: { dataset?: UploadedDataset }) => {
    let calls = 0;
    const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
      if (role === "SKEPTIC") return skepticJson;
      calls += 1;
      if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "inspect_entity_activity", id: "ENTITY-HIGH-ACTIVITY", selectedTool: "inspect_entity_activity", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
      return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "inspect_entity_activity", hypothesis: "A subset of entity activity warrants review under published rules.", alternativeExplanation: "Benign batching may explain the concentration.", rationale: "Grounded in the freshly looked-up entity record.", evidenceRefs: ["E-008"] });
    };
    return runEventAgents(analysis, evidence, objective, { request, dataset: options?.dataset });
  };
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, liveToolRunner);
  assert.equal(result.validation.status, "VALIDATED");
  assert.ok(result.validation.checks.find((check) => check.id === "ON_DEMAND_EVIDENCE_REPRODUCIBLE")?.passed);
  assert.equal(result.artifact.onDemandEvidence.length, 1);
  assert.equal(result.artifact.onDemandEvidence[0].id, "E-008");
  assert.equal(publishedEventArtifactMatches(result.artifact, result.validation), true);
});

test("a tampered on-demand Evidence record is caught by ON_DEMAND_EVIDENCE_REPRODUCIBLE without touching any other event check", async () => {
  const liveToolRunner = (analysis: Parameters<typeof runEventAgents>[0], evidence: Parameters<typeof runEventAgents>[1], objective?: string, options?: { dataset?: UploadedDataset }) => {
    let calls = 0;
    const request = async ({ role }: { role: "INVESTIGATOR" | "SKEPTIC" }) => {
      if (role === "SKEPTIC") return skepticJson;
      calls += 1;
      if (calls === 1) return JSON.stringify({ action: "CALL_TOOL", tool: "inspect_entity_activity", id: "ENTITY-HIGH-ACTIVITY", selectedTool: "inspect_entity_activity", hypothesis: "interim", alternativeExplanation: "interim", rationale: "interim", evidenceRefs: [] });
      return JSON.stringify({ action: "FORM_HYPOTHESIS", tool: "NONE", id: "NONE", selectedTool: "inspect_entity_activity", hypothesis: "A subset of entity activity warrants review under published rules.", alternativeExplanation: "Benign batching may explain the concentration.", rationale: "Grounded in the freshly looked-up entity record.", evidenceRefs: ["E-008"] });
    };
    return runEventAgents(analysis, evidence, objective, { request, dataset: options?.dataset });
  };
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, liveToolRunner);
  const tampered = structuredClone(result.artifact);
  tampered.onDemandEvidence[0].result = "A fabricated activity summary that was never actually computed.";
  const validation = validateEventTransactionArtifact(eventActivityFixture, tampered);
  assert.equal(validation.status, "BLOCKED");
  assert.equal(validation.checks.find((check) => check.id === "ON_DEMAND_EVIDENCE_REPRODUCIBLE")?.passed, false);
  assert.ok(validation.checks.filter((check) => check.id !== "ON_DEMAND_EVIDENCE_REPRODUCIBLE").every((check) => check.passed), "tampering only the on-demand record must not fail unrelated baseline checks");
});

test("Investigator timeout preserves the deterministic artifact with an exact reason", async () => {
  const request = ({ signal }: { signal: AbortSignal }) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const runner = (analysis: Parameters<typeof runEventAgents>[0], evidence: Parameters<typeof runEventAgents>[1], objective?: string) => runEventAgents(analysis, evidence, objective, { request, timeoutMs: 5 });
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, runner);
  assert.equal(result.validation.status, "VALIDATED"); assert.equal(result.artifact.investigator.source, "FALLBACK"); assert.equal(result.artifact.technicalTrace.agentCalls[0].fallbackReason, "TIMEOUT"); assert.equal(result.artifact.analysis.dataset.eventCount, 30);
});

test("Skeptic timeout preserves a successful Investigator and deterministic artifact", async () => {
  const request = ({ role, signal }: { role: "INVESTIGATOR" | "SKEPTIC"; signal: AbortSignal }) => role === "INVESTIGATOR" ? Promise.resolve(investigatorJson) : new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const analysis = analyzeEventTransactions(eventActivityFixture), evidence = buildEventTransactionEvidence(analysis), result = await runEventAgents(analysis, evidence, undefined, { request, timeoutMs: 5 });
  assert.equal(result.investigator.source, "LLM"); assert.equal(result.skeptic.source, "FALLBACK"); assert.equal(result.agentCalls[1].outcome, "TIMEOUT"); assert.deepEqual(analysis, analyzeEventTransactions(eventActivityFixture));
});

test("validator blocks tampered event counts and cluster membership", async () => {
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallbackAgents);
  const countTamper = structuredClone(result.artifact); countTamper.analysis.dataset.eventCount += 1; const countValidation = validateEventTransactionArtifact(eventActivityFixture, countTamper); assert.equal(countValidation.status, "BLOCKED"); assert.equal(countValidation.checks.find((item) => item.id === "EVENT_COUNT")?.passed, false);
  const clusterTamper = structuredClone(result.artifact); clusterTamper.analysis.clusters[0].sourceRows.pop(); const clusterValidation = validateEventTransactionArtifact(eventActivityFixture, clusterTamper); assert.equal(clusterValidation.status, "BLOCKED"); assert.equal(clusterValidation.checks.find((item) => item.id === "CLUSTER_MEMBERSHIP")?.passed, false);
});

test("all event Evidence references resolve to canonical IDs and source records", async () => {
  const result = await runEventTransactionInvestigation({ dataset: eventActivityFixture, signals: ["amount"] }, fallbackAgents), ids = new Set(result.artifact.evidence.map((item) => item.id));
  assert.ok(result.artifact.investigator.evidenceRefs.every((id) => ids.has(id))); assert.ok(result.artifact.skeptic.evidenceRefs.every((id) => ids.has(id))); assert.ok(result.artifact.analysis.detection.notableEvents.every((event) => event.sourceRow > 0 && event.evidenceRefs.every((id) => ids.has(id))));
});

test("cross-sectional, time-series and ambiguous routing regressions remain unchanged", () => {
  assert.equal(admitInvestigation({ dataset: russianBankClients60, signals: ["Возраст"] }).shape.tag, "CROSS_SECTIONAL");
  const temporal = admitInvestigation({ dataset: fintechDemoDataset(), signals: ["cash_flow"] }); assert.equal(temporal.shape.tag, "TIME_SERIES"); assert.equal(temporal.workflowId, "generic-time-series-investigation");
  assert.equal(admitInvestigation({ dataset: ambiguous, signals: ["value"] }).status, "NEEDS_INPUT");
});

test("API and workspace use a dedicated event branch with event semantics", () => {
  const api = readFileSync(new URL("../../../app/api/investigate/route.ts", import.meta.url), "utf8"), workspace = readFileSync(new URL("../../../components/nexus/workspace/InvestigationWorkspace.tsx", import.meta.url), "utf8");
  assert.match(api, /routeDecision\.workflowId === "event-transaction-investigation"/); assert.ok(api.indexOf('routeDecision.workflowId === "event-transaction-investigation"') < api.indexOf("executeAdmitted(admissionRequest"));
  assert.match(workspace, /ОДНО СОБЫТИЕ\/ТРАНЗАКЦИЯ НА СТРОКУ/); assert.match(workspace, /NEXUS определил набор как журнал событий\/транзакций/); assert.match(workspace, /results\.kind === "EVENT_TRANSACTION"/); assert.match(workspace, /isEventTransaction \? "Не используется"/);
});
