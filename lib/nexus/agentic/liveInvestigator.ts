import "server-only";
import OpenAI from "openai";
import { MAX_LLM_CALLS } from "./types";
import type { EvidenceRecord, ToolContext } from "./types";
import { validToolArguments, type NexusToolDefinition } from "./toolPack";
import { INVESTIGATOR_SYSTEM_INSTRUCTIONS } from "../tasks/agentInstructions.ts";

import { createLlmAudit, LlmRequestFailure, type LlmRuntimeMetadata } from "./llmRequest.ts";
export const MAX_INVESTIGATOR_TOOL_CALLS = 4;
/** One-shot repair for the one failure a `strict:true` per-field schema cannot itself prevent: a "pair"
 * tool's `left`/`right` enums are independent, so nothing stops the model choosing the same column for
 * both. Bounded and additive — it only replaces what would otherwise be an immediate fallback. Mirrors
 * liveSkeptic.ts's equivalent constant/mechanism. */
const MAX_ARGUMENT_REPAIR_RETRIES = 1;
type Action = { action: "CALL_TOOL" | "FORM_HYPOTHESIS"; tool: string | "NONE"; arguments: { column: string; left: string; right: string }; reason_summary: string; primary_hypothesis: string; alternative_explanation: string; supporting_evidence: string[]; limitations: string[]; };
type TraceAction = Action["action"] | "ARGUMENT_REPAIR";
export type LiveInvestigatorResult = { source: "LLM" | "FALLBACK"; runtime?: LlmRuntimeMetadata; llmCalls: number; latencies: number[]; toolCalls: number; actions: Array<{ action: TraceAction; summary: string; source: "LLM" | "FALLBACK"; tool?: string; evidenceRefs?: string[]; repair_reason?: "DUPLICATE_PAIR_COLUMN" }>; hypothesis: { primary: string; alternative: string; supportingEvidence: string[]; limitations: string[]; }; };

function evidenceRefSchema(evidenceIds: string[]) {
  return evidenceIds.length
    ? { type: "array", items: { type: "string", enum: evidenceIds } }
    : { type: "array", items: { type: "string" }, maxItems: 0 };
}
function schema(columns: string[], toolNames: string[], evidenceIds: string[]) { const option = [...columns, "NONE"]; return { type: "object", additionalProperties: false, required: ["action", "tool", "arguments", "reason_summary", "primary_hypothesis", "alternative_explanation", "supporting_evidence", "limitations"], properties: { action: { type: "string", enum: ["CALL_TOOL", "FORM_HYPOTHESIS"] }, tool: { type: "string", enum: [...toolNames, "NONE"] }, arguments: { type: "object", additionalProperties: false, required: ["column", "left", "right"], properties: { column: { type: "string", enum: option }, left: { type: "string", enum: option }, right: { type: "string", enum: option } } }, reason_summary: { type: "string" }, primary_hypothesis: { type: "string" }, alternative_explanation: { type: "string" }, supporting_evidence: evidenceRefSchema(evidenceIds), limitations: { type: "array", items: { type: "string" } } } } as const; }
/** Forces exactly one CALL_TOOL of the same already-selected tool, with fresh left/right choices — the
 * only fields that caused the failure. Cannot itself forbid left === right, so the instruction spells out
 * the mistake explicitly. */
function pairRepairSchema(columns: string[], toolName: string, evidenceIds: string[]) {
  return {
    type: "object", additionalProperties: false,
    required: ["action", "tool", "arguments", "reason_summary", "primary_hypothesis", "alternative_explanation", "supporting_evidence", "limitations"],
    properties: {
      action: { type: "string", enum: ["CALL_TOOL"] },
      tool: { type: "string", enum: [toolName] },
      arguments: { type: "object", additionalProperties: false, required: ["column", "left", "right"], properties: { column: { type: "string", enum: ["NONE"] }, left: { type: "string", enum: columns }, right: { type: "string", enum: columns } } },
      reason_summary: { type: "string" },
      primary_hypothesis: { type: "string" },
      alternative_explanation: { type: "string" },
      supporting_evidence: evidenceRefSchema(evidenceIds),
      limitations: { type: "array", items: { type: "string" } },
    },
  } as const;
}
function valid(action: Action, columns: string[], pack: NexusToolDefinition[]) {
  if (!action || typeof action !== "object" || !["CALL_TOOL", "FORM_HYPOTHESIS"].includes(action.action) || typeof action.tool !== "string" ||
    !action.arguments || ["column", "left", "right"].some(key => typeof action.arguments[key as keyof Action["arguments"]] !== "string") ||
    [action.reason_summary, action.primary_hypothesis, action.alternative_explanation].some(value => typeof value !== "string") ||
    !Array.isArray(action.supporting_evidence) || action.supporting_evidence.some(id => typeof id !== "string") ||
    !Array.isArray(action.limitations) || action.limitations.some(value => typeof value !== "string")) return false;
  if (action.action === "FORM_HYPOTHESIS") return action.supporting_evidence.every((id) => /^E-\d+$/.test(id));
  const tool = pack.find((item) => item.name === action.tool);
  if (!tool) return false;
  const args: Record<string, string> = tool.argumentKind === "pair" ? { left: action.arguments.left, right: action.arguments.right } : tool.argumentKind === "column" ? { column: action.arguments.column } : {};
  return validToolArguments(tool, columns, args);
}
/**
 * `hypothesis.*` here is the fallback that reaches the Result page/PDF narrative directly (no LLM call
 * failed silently into English) — it must stay Russian for the same reason the live LLM output must.
 * `actions[].summary` only ever feeds the Technical Trace (see orchestrator.ts's `event()` calls), which is
 * explicitly allowed to stay in its original technical wording, so it is left unchanged.
 */
function fallback(evidence: EvidenceRecord[], actions: LiveInvestigatorResult["actions"]): LiveInvestigatorResult { return { source: "FALLBACK", llmCalls: 0, latencies: [], toolCalls: 0, actions: [...actions, { action: "FORM_HYPOTHESIS", summary: "Live Investigator unavailable; completing with bounded inconclusive fallback.", source: "FALLBACK", evidenceRefs: evidence.map((item) => item.id) }], hypothesis: { primary: "Live Investigator не завершил работу; детерминированные наблюдения доступны, но без причинного вывода.", alternative: "Тренд, сезонность, погрешность измерений и недостающий контекст остаются вероятными альтернативными объяснениями.", supportingEvidence: evidence.map((item) => item.id), limitations: ["Решение LLM-агента недоступно.", "Корреляция не устанавливает причинно-следственную связь."] } }; }

/** `pack` is the full resolved domain tool set; only entries whose allowedAgents include INVESTIGATOR are offered as a primary choice. */
export async function runLiveInvestigator(input: { context: ToolContext; observerFindings: string[]; evidence: EvidenceRecord[]; remainingLlmCalls: number; pack: NexusToolDefinition[]; objective?: string; execute: (tool: string, args: Record<string, string>) => EvidenceRecord; }): Promise<LiveInvestigatorResult> {
  const audit = createLlmAudit("INVESTIGATOR");
  let llmCalls = 0; let toolCalls = 0;
  const safeFallback = (evidence: EvidenceRecord[], actions: LiveInvestigatorResult["actions"], reason = "INVALID_STRUCTURED_OUTPUT"): LiveInvestigatorResult => ({ ...fallback(evidence, actions), llmCalls, toolCalls, latencies: audit.steps.map(step => step.latencyMs), runtime: audit.finish(reason) });
  const columns = input.context.signals; const actions: LiveInvestigatorResult["actions"] = []; if (!process.env.OPENAI_API_KEY) return safeFallback(input.evidence, actions, "MISSING_API_KEY");
  const pack = input.pack.filter((tool) => tool.allowedAgents.includes("INVESTIGATOR"));
  const toolNames = pack.map((tool) => tool.name);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, logLevel: "off" }); let evidence = [...input.evidence]; const latencies: number[] = [];
  let argumentRepairAttempts = 0;
  const requestArgumentRepair = async (toolName: string, badColumn: string): Promise<Action> => {
    const started = Date.now();
    llmCalls += 1;
    const response = await audit.request(signal => client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        store: false,
        reasoning: { effort: "minimal" },
        max_output_tokens: 2000,
        input: [
          { role: "system", content: INVESTIGATOR_SYSTEM_INSTRUCTIONS },
          { role: "user", content: JSON.stringify({ instruction: `Call ${toolName} again with two DIFFERENT columns. Your previous call used "${badColumn}" for both left and right, which is invalid — left and right must not be equal.`, allowedColumns: columns, currentEvidenceIds: evidence.map(item => item.id), evidenceContract: "supporting_evidence may contain only currentEvidenceIds. The Evidence from this CALL_TOOL does not exist yet. Never predict its ID; use [] if no current Evidence supports this call." }) },
        ],
        text: { format: { type: "json_schema", name: "investigator_argument_repair", strict: true, schema: pairRepairSchema(columns, toolName, evidence.map(item => item.id)) } },
      },
      { signal },
    ));
    latencies.push(Date.now() - started);
    const repaired = JSON.parse(response.output_text) as Action;
    if (typeof repaired.arguments?.left !== "string" || typeof repaired.arguments?.right !== "string") throw new Error("INVALID_STRUCTURED_OUTPUT");
    return repaired;
  };
  for (let turn = 0; turn < 2 && llmCalls < Math.min(MAX_LLM_CALLS, input.remainingLlmCalls); turn += 1) { const first = turn === 0; const instruction = first ? "Select exactly one CALL_TOOL first. Choose the focus, tool and arguments yourself from the allowed catalog. Do not calculate values." : "You received deterministic evidence from your first tool action. Now return FORM_HYPOTHESIS using only valid evidence IDs. Do not call another tool, calculate values, or invent causality."; const started = Date.now(); try { llmCalls += 1; const response = await audit.request(signal => client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-5-mini", store: false, reasoning: { effort: "minimal" }, max_output_tokens: 2000, input: [{ role: "system", content: INVESTIGATOR_SYSTEM_INSTRUCTIONS }, { role: "user", content: JSON.stringify({ instruction, evidenceContract: "supporting_evidence may contain only currentEvidenceIds. Never invent or predict future Evidence IDs. For CALL_TOOL, its Evidence does not exist until execution and can be cited only on a later turn. Use [] when no current Evidence supports the response.", currentEvidenceIds: evidence.map(item => item.id), userGoal: input.objective?.trim() ? `${input.objective.trim()} — investigate descriptively and do not assert causality.` : "Investigate descriptive changes without asserting causality.", allowedColumns: columns, toolCatalog: pack.map((tool) => ({ name: tool.name, description: tool.description, args: tool.argumentKind === "pair" ? ["left", "right"] : tool.argumentKind === "column" ? ["column"] : [] })), observerFindings: input.observerFindings, evidence: evidence.map((item) => ({ id: item.id, tool: item.tool, variables: item.variables, result: item.result })) }) }], text: { format: { type: "json_schema", name: "investigator_action", strict: true, schema: schema(columns, toolNames, evidence.map(item => item.id)) } } }, { signal })); latencies.push(Date.now() - started); const action = JSON.parse(response.output_text) as Action; if (valid(action, columns, pack) && action.supporting_evidence.some(id => !evidence.some(record => record.id === id))) return safeFallback(evidence, actions, "INVALID_EVIDENCE_REFERENCE");
      if (!valid(action, columns, pack)) {
        const collidedTool = action.action === "CALL_TOOL" ? pack.find((item) => item.name === action.tool) : undefined;
        const collided = collidedTool?.argumentKind === "pair" && action.arguments.left === action.arguments.right && columns.includes(action.arguments.left);
        if (!collided || argumentRepairAttempts >= MAX_ARGUMENT_REPAIR_RETRIES || llmCalls >= input.remainingLlmCalls) {
          return safeFallback(evidence, [...actions, { action: "FORM_HYPOTHESIS", summary: "Live Investigator returned an invalid action; no unsafe tool call was executed.", source: "FALLBACK" }]);
        }
        argumentRepairAttempts += 1;
        actions.push({ action: "ARGUMENT_REPAIR", summary: `ARGUMENT_REPAIR: ${collidedTool!.name} received the same column ("${action.arguments.left}") for left and right.`, source: "LLM", tool: collidedTool!.name, repair_reason: "DUPLICATE_PAIR_COLUMN" });
        const repaired = await requestArgumentRepair(collidedTool!.name, action.arguments.left);
        if (repaired.supporting_evidence.some(id => !evidence.some(record => record.id === id))) return safeFallback(evidence, actions, "INVALID_EVIDENCE_REFERENCE");
        const repairedArgs: Record<string, string> = { left: repaired.arguments.left, right: repaired.arguments.right };
        if (!validToolArguments(collidedTool!, columns, repairedArgs)) return safeFallback(evidence, actions);
        const record = input.execute(collidedTool!.name, repairedArgs);
        evidence = [...evidence, record]; toolCalls += 1;
        actions.push({ action: "CALL_TOOL", summary: repaired.reason_summary, source: "LLM", tool: collidedTool!.name, evidenceRefs: [record.id] });
        continue;
      }
      if (action.action === "FORM_HYPOTHESIS") { const references = [...action.supporting_evidence]; return { source: "LLM", runtime: audit.finish(), llmCalls, latencies, toolCalls, actions: [...actions, { action: "FORM_HYPOTHESIS", summary: action.reason_summary, source: "LLM", evidenceRefs: references }], hypothesis: { primary: action.primary_hypothesis, alternative: action.alternative_explanation, supportingEvidence: references, limitations: action.limitations } }; }
      if (toolCalls >= MAX_INVESTIGATOR_TOOL_CALLS) return safeFallback(evidence, actions); const selectedTool = pack.find((tool) => tool.name === action.tool)!; const args: Record<string, string> = selectedTool.argumentKind === "pair" ? { left: action.arguments.left, right: action.arguments.right } : selectedTool.argumentKind === "column" ? { column: action.arguments.column } : {}; const record = input.execute(selectedTool.name, args); evidence = [...evidence, record]; toolCalls += 1; actions.push({ action: "CALL_TOOL", summary: action.reason_summary, source: "LLM", tool: selectedTool.name, evidenceRefs: [record.id] });
    } catch (error) { return safeFallback(evidence, actions, error instanceof LlmRequestFailure ? error.metadata.errorCategory : "INVALID_STRUCTURED_OUTPUT"); }
  }
  return safeFallback(evidence, actions);
}
