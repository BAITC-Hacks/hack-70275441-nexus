import "server-only";
import OpenAI from "openai";
import type { EvidenceRecord, ToolContext } from "./types";
import { validToolArguments, type NexusToolDefinition } from "./toolPack";
import { SKEPTIC_SYSTEM_INSTRUCTIONS } from "../tasks/agentInstructions.ts";

import { createLlmAudit, LlmRequestFailure, type LlmRuntimeMetadata } from "./llmRequest.ts";
export const MAX_SKEPTIC_TOOL_CALLS = 2;
const MAX_SKEPTIC_VERDICT_REPAIR_RETRIES = 1;
/** One-shot repair for the one failure a `strict:true` per-field schema cannot itself prevent: a "pair"
 * tool's `left`/`right` enums are independent, so nothing stops the model choosing the same column for
 * both. Bounded and additive — it only replaces what would otherwise be an immediate fallback. */
const MAX_ARGUMENT_REPAIR_RETRIES = 1;

type Verdict = "SUPPORTED" | "CHALLENGED" | "INCONCLUSIVE";
type Action = {
  action: "CALL_TOOL" | "FINAL_VERDICT";
  tool: string | "NONE";
  arguments: { column: string; left: string; right: string };
  reason_summary: string;
  status: Verdict;
  challenge_summary: string;
  supporting_evidence: string[];
  weaknesses: string[];
};
type TraceAction = Action["action"] | "VERDICT_REPAIR" | "ARGUMENT_REPAIR";

export type LiveSkepticResult = {
  runtime?: LlmRuntimeMetadata;
  source: "LLM" | "FALLBACK";
  llmCalls: number;
  toolCalls: number;
  latencies: number[];
  actions: Array<{
    action: TraceAction;
    summary: string;
    source: "LLM" | "FALLBACK";
    tool?: string;
    evidenceRefs?: string[];
    required_evidence_id?: string;
    repair_reason?: "INVALID_FINAL_ACTION" | "MISSING_REQUIRED_EVIDENCE" | "DUPLICATE_PAIR_COLUMN";
    received_action?: "CALL_TOOL";
    required_action?: "FINAL_VERDICT";
  }>;
  verdict: {
    status: Verdict;
    challenge: string;
    evidenceRefs: string[];
    alternatives: string[];
  };
};

/**
 * `verdict.*` here is the fallback that reaches the Result page/PDF narrative directly, so it must stay
 * Russian for the same reason the live LLM output must. `actions[].summary` only ever feeds the Technical
 * Trace (see orchestrator.ts's `event()` calls), which is explicitly allowed to stay in its original
 * technical wording, so it is left unchanged.
 */
function fallback(
  evidence: EvidenceRecord[],
  actions: LiveSkepticResult["actions"],
): LiveSkepticResult {
  return {
    source: "FALLBACK",
    llmCalls: 0,
    toolCalls: 0,
    latencies: [],
    actions: [
      ...actions,
      {
        action: "FINAL_VERDICT",
        summary: "Live Skeptic unavailable; conservative inconclusive verdict.",
        source: "FALLBACK",
        evidenceRefs: evidence.map((item) => item.id),
      },
    ],
    verdict: {
      status: "INCONCLUSIVE",
      challenge:
        "Live Skeptic не завершил проверку; детерминированные доказательства доступны, но без причинного вывода.",
      evidenceRefs: evidence.map((item) => item.id),
      alternatives: ["Тренд или сезонность", "Погрешность измерения"],
    },
  };
}

function evidenceRefSchema(evidenceIds: string[]) {
  return evidenceIds.length
    ? { type: "array", items: { type: "string", enum: evidenceIds } }
    : { type: "array", items: { type: "string" }, maxItems: 0 };
}

function actionSchema(columns: string[], toolNames: string[], evidenceIds: string[], repairOnly = false) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "action",
      "tool",
      "arguments",
      "reason_summary",
      "status",
      "challenge_summary",
      "supporting_evidence",
      "weaknesses",
    ],
    properties: {
      action: {
        type: "string",
        enum: repairOnly ? ["FINAL_VERDICT"] : ["CALL_TOOL", "FINAL_VERDICT"],
      },
      tool: {
        type: "string",
        enum: repairOnly ? ["NONE"] : [...toolNames, "NONE"],
      },
      arguments: {
        type: "object",
        additionalProperties: false,
        required: ["column", "left", "right"],
        properties: {
          column: {
            type: "string",
            enum: repairOnly ? ["NONE"] : [...columns, "NONE"],
          },
          left: { type: "string", enum: repairOnly ? ["NONE"] : [...columns, "NONE"] },
          right: { type: "string", enum: repairOnly ? ["NONE"] : [...columns, "NONE"] },
        },
      },
      reason_summary: { type: "string" },
      status: { type: "string", enum: ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"] },
      challenge_summary: { type: "string" },
      supporting_evidence: evidenceRefSchema(evidenceIds),
      weaknesses: { type: "array", items: { type: "string" } },
    },
  };
}

/** Forces exactly one CALL_TOOL of the same already-selected tool, with fresh left/right choices — the
 * only fields that caused the failure. Cannot itself forbid left === right (still an independent
 * per-field enum), so the accompanying instruction spells out the mistake explicitly. */
function pairRepairSchema(columns: string[], toolName: string, evidenceIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "tool", "arguments", "reason_summary", "status", "challenge_summary", "supporting_evidence", "weaknesses"],
    properties: {
      action: { type: "string", enum: ["CALL_TOOL"] },
      tool: { type: "string", enum: [toolName] },
      arguments: {
        type: "object",
        additionalProperties: false,
        required: ["column", "left", "right"],
        properties: {
          column: { type: "string", enum: ["NONE"] },
          left: { type: "string", enum: columns },
          right: { type: "string", enum: columns },
        },
      },
      reason_summary: { type: "string" },
      status: { type: "string", enum: ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"] },
      challenge_summary: { type: "string" },
      supporting_evidence: evidenceRefSchema(evidenceIds),
      weaknesses: { type: "array", items: { type: "string" } },
    },
  };
}

function validEvidenceRefs(action: Action) {
  return [...action.supporting_evidence];
}

function hasValidShape(action: Action): boolean {
  return Boolean(action && typeof action === "object" && ["CALL_TOOL", "FINAL_VERDICT"].includes(action.action) &&
    typeof action.tool === "string" && action.arguments && ["column", "left", "right"].every(key => typeof action.arguments[key as keyof Action["arguments"]] === "string") &&
    [action.reason_summary, action.challenge_summary].every(value => typeof value === "string") &&
    ["SUPPORTED", "CHALLENGED", "INCONCLUSIVE"].includes(action.status) &&
    Array.isArray(action.supporting_evidence) && action.supporting_evidence.every(id => typeof id === "string") &&
    Array.isArray(action.weaknesses) && action.weaknesses.every(value => typeof value === "string"));
}

function hasRequiredSkepticEvidence(
  refs: string[],
  requiredEvidenceId: string | undefined,
) {
  return !requiredEvidenceId || refs.includes(requiredEvidenceId);
}

function passesExistingStrictValidation(
  refs: string[],
  actions: LiveSkepticResult["actions"],
) {
  return (
    !actions.some((item) => item.action === "CALL_TOOL") ||
    refs.some((id) =>
      actions.some((item) => item.evidenceRefs?.includes(id)),
    )
  );
}

function toolArgs(tool: NexusToolDefinition, action: Action): Record<string, string> {
  return tool.argumentKind === "pair"
    ? { left: action.arguments.left, right: action.arguments.right }
    : tool.argumentKind === "column"
      ? { column: action.arguments.column }
      : {};
}

/** `pack` is the full resolved domain tool set; only entries whose allowedAgents include SKEPTIC are offered as a primary choice. */
export async function runLiveSkeptic(input: {
  context: ToolContext;
  hypothesis: string;
  alternative: string;
  observerFindings: string[];
  evidence: EvidenceRecord[];
  remainingLlmCalls: number;
  pack: NexusToolDefinition[];
  objective?: string;
  execute: (tool: string, args: Record<string, string>) => EvidenceRecord;
}): Promise<LiveSkepticResult> {
  const audit = createLlmAudit("SKEPTIC");
  const actions: LiveSkepticResult["actions"] = [];
  let llmCalls = 0;
  const safeFallback = (evidence: EvidenceRecord[], reason = "INVALID_STRUCTURED_OUTPUT"): LiveSkepticResult => ({ ...fallback(evidence, actions), llmCalls, toolCalls: actions.filter(item => item.action === "CALL_TOOL").length, latencies: audit.steps.map(step => step.latencyMs), runtime: audit.finish(reason) });
  const columns = input.context.signals;
  if (!process.env.OPENAI_API_KEY) return safeFallback(input.evidence, "MISSING_API_KEY");
  const pack = input.pack.filter((tool) => tool.allowedAgents.includes("SKEPTIC"));
  const toolNames = pack.map((tool) => tool.name);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, logLevel: "off" });
  let evidence = [...input.evidence];
  const latencies: number[] = [];
  let repairAttempts = 0;
  let argumentRepairAttempts = 0;

  const requestAction = async (instruction: string, repairOnly = false) => {
    const started = Date.now();
    llmCalls += 1;
    const response = await audit.request(signal => client.responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        store: false,
        reasoning: { effort: "minimal" },
        max_output_tokens: 2000,
        input: [
          {
            role: "system",
            content: SKEPTIC_SYSTEM_INSTRUCTIONS,
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction,
              evidenceContract: "supporting_evidence may contain only currentEvidenceIds. Never invent or predict future Evidence IDs. For CALL_TOOL, its Evidence does not exist until execution and can be cited only on a later turn. Use [] when no current Evidence supports the response.",
              currentEvidenceIds: evidence.map(item => item.id),
              userGoal: input.objective?.trim() || "Challenge the candidate explanation without asserting causality.",
              hypothesis: input.hypothesis,
              alternative: input.alternative,
              observerFindings: input.observerFindings,
              allowedColumns: columns,
              tools: repairOnly
                ? []
                : pack.map((tool) => ({ name: tool.name, description: tool.description })),
              evidence: evidence.map((item) => ({
                id: item.id,
                tool: item.tool,
                result: item.result,
              })),
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: repairOnly ? "skeptic_verdict_repair" : "skeptic_action",
            strict: true,
            schema: actionSchema(columns, toolNames, evidence.map(item => item.id), repairOnly),
          },
        },
      },
      { signal },
    ));
    latencies.push(Date.now() - started);
    const action = JSON.parse(response.output_text) as Action;
    if (!hasValidShape(action)) throw new Error("INVALID_STRUCTURED_OUTPUT");
    return action;
  };

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
          { role: "system", content: SKEPTIC_SYSTEM_INSTRUCTIONS },
          {
            role: "user",
            content: JSON.stringify({
              instruction: `Call ${toolName} again with two DIFFERENT columns. Your previous call used "${badColumn}" for both left and right, which is invalid — left and right must not be equal.`,
              allowedColumns: columns,
              currentEvidenceIds: evidence.map(item => item.id),
              evidenceContract: "supporting_evidence may contain only currentEvidenceIds. The Evidence from this CALL_TOOL does not exist yet. Never predict its ID; use [] if no current Evidence supports this call.",
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "skeptic_argument_repair",
            strict: true,
            schema: pairRepairSchema(columns, toolName, evidence.map(item => item.id)),
          },
        },
      },
      { signal },
    ));
    latencies.push(Date.now() - started);
    const repaired = JSON.parse(response.output_text) as Action;
    if (!hasValidShape(repaired)) throw new Error("INVALID_STRUCTURED_OUTPUT");
    return repaired;
  };

  for (
    let turn = 0;
    turn < 2 && llmCalls < input.remainingLlmCalls;
    turn += 1
  ) {
    const firstTurn = turn === 0;

    try {
      let action = await requestAction(
        firstTurn
          ? "Select exactly one CALL_TOOL adversarial check."
          : "Use the returned deterministic evidence and return FINAL_VERDICT. supporting_evidence MUST include the newly returned evidence ID.",
      );

      if (action.supporting_evidence.some(id => !evidence.some(record => record.id === id))) return safeFallback(evidence, "INVALID_EVIDENCE_REFERENCE");

      const invalidFinalAction =
        actions.some((item) => item.action === "CALL_TOOL") &&
        action.action === "CALL_TOOL";
      if (invalidFinalAction) {
        action = {
          ...action,
          action: "FINAL_VERDICT",
          supporting_evidence: [],
          challenge_summary: "Invalid final action: a verdict was required after the Skeptic tool result.",
        };
      }

      if (action.action === "FINAL_VERDICT") {
        const refs = validEvidenceRefs(action);
        const latestSkepticEvidenceId = actions
          .filter((item) => item.action === "CALL_TOOL")
          .at(-1)?.evidenceRefs?.[0];

        if (
          passesExistingStrictValidation(refs, actions) &&
          hasRequiredSkepticEvidence(refs, latestSkepticEvidenceId)
        ) {
          return {
            source: "LLM",
            runtime: audit.finish(),
            llmCalls,
            toolCalls: actions.filter((item) => item.action === "CALL_TOOL").length,
            latencies,
            actions: [
              ...actions,
              {
                action: "FINAL_VERDICT",
                summary: action.challenge_summary,
                source: "LLM",
                evidenceRefs: refs,
              },
            ],
            verdict: {
              status: action.status,
              challenge: action.challenge_summary,
              evidenceRefs: refs,
              alternatives: action.weaknesses,
            },
          };
        }

        if (
          latestSkepticEvidenceId &&
          repairAttempts < MAX_SKEPTIC_VERDICT_REPAIR_RETRIES &&
          llmCalls < input.remainingLlmCalls
        ) {
          repairAttempts += 1;
          const requiredEvidence = evidence.find(
            (item) => item.id === latestSkepticEvidenceId,
          );
          actions.push({
            action: "VERDICT_REPAIR",
            summary: invalidFinalAction
              ? "VERDICT_REPAIR: received CALL_TOOL where FINAL_VERDICT was required."
              : `VERDICT_REPAIR: missing required evidence reference ${latestSkepticEvidenceId}.`,
            source: "LLM",
            evidenceRefs: [latestSkepticEvidenceId],
            required_evidence_id: latestSkepticEvidenceId,
            repair_reason: invalidFinalAction ? "INVALID_FINAL_ACTION" : "MISSING_REQUIRED_EVIDENCE",
            ...(invalidFinalAction ? { received_action: "CALL_TOOL" as const, required_action: "FINAL_VERDICT" as const } : {}),
          });

          const repaired = await requestAction(
            `Return FINAL_VERDICT only. Your previous response was invalid because ${invalidFinalAction ? "it returned CALL_TOOL after a verdict was required" : `supporting_evidence omitted the required evidence ID ${latestSkepticEvidenceId}`}. Include ${latestSkepticEvidenceId} in supporting_evidence. Do not call another tool. Use only existing evidence IDs. Do not invent analytical numbers. Required evidence result: ${JSON.stringify(requiredEvidence?.result)}. Allowed verdict statuses: SUPPORTED, CHALLENGED, INCONCLUSIVE. Existing evidence IDs: ${evidence.map((item) => item.id).join(", ")}.`,
            true,
          );
          if (repaired.supporting_evidence.some(id => !evidence.some(record => record.id === id))) return safeFallback(evidence, "INVALID_EVIDENCE_REFERENCE");
          const repairedRefs = validEvidenceRefs(repaired);

          if (
            repaired.action === "FINAL_VERDICT" &&
            repaired.tool === "NONE" &&
            passesExistingStrictValidation(repairedRefs, actions) &&
            hasRequiredSkepticEvidence(repairedRefs, latestSkepticEvidenceId)
          ) {
            return {
              source: "LLM",
              runtime: audit.finish(),
              llmCalls,
              toolCalls: actions.filter((item) => item.action === "CALL_TOOL").length,
              latencies,
              actions: [
                ...actions,
                {
                  action: "FINAL_VERDICT",
                  summary: repaired.challenge_summary,
                  source: "LLM",
                  evidenceRefs: repairedRefs,
                },
              ],
              verdict: {
                status: repaired.status,
                challenge: repaired.challenge_summary,
                evidenceRefs: repairedRefs,
                alternatives: repaired.weaknesses,
              },
            };
          }
        }

        return safeFallback(evidence);
      }

      const selectedTool = pack.find((tool) => tool.name === action.tool);
      if (!selectedTool) return safeFallback(evidence);
      let args = toolArgs(selectedTool, action);
      let callSummary = action.reason_summary;
      if (!validToolArguments(selectedTool, columns, args)) {
        const collided = selectedTool.argumentKind === "pair" && args.left === args.right && columns.includes(args.left);
        if (!collided || argumentRepairAttempts >= MAX_ARGUMENT_REPAIR_RETRIES || llmCalls >= input.remainingLlmCalls) {
          return safeFallback(evidence);
        }
        argumentRepairAttempts += 1;
        actions.push({
          action: "ARGUMENT_REPAIR",
          summary: `ARGUMENT_REPAIR: ${selectedTool.name} received the same column ("${args.left}") for left and right.`,
          source: "LLM",
          tool: selectedTool.name,
          repair_reason: "DUPLICATE_PAIR_COLUMN",
        });
        const repaired = await requestArgumentRepair(selectedTool.name, args.left);
        if (repaired.supporting_evidence.some(id => !evidence.some(record => record.id === id))) return safeFallback(evidence, "INVALID_EVIDENCE_REFERENCE");
        args = toolArgs(selectedTool, repaired);
        callSummary = repaired.reason_summary;
        if (!validToolArguments(selectedTool, columns, args)) return safeFallback(evidence);
      }

      const record = input.execute(selectedTool.name, args);
      evidence = [...evidence, record];
      actions.push({
        action: "CALL_TOOL",
        summary: callSummary,
        source: "LLM",
        tool: selectedTool.name,
        evidenceRefs: [record.id],
      });
    } catch (error) {
      return safeFallback(evidence, error instanceof LlmRequestFailure ? error.metadata.errorCategory : "INVALID_STRUCTURED_OUTPUT");
    }
  }

  return safeFallback(evidence);
}
