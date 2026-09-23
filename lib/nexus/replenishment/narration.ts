import OpenAI from "openai";
import { createLlmAudit } from "../agentic/llmRequest.ts";
import type { ReplenishmentRecommendation } from "./calculation.ts";

export const REPLENISHMENT_NARRATOR_SYSTEM_PROMPT = `Ты пишешь краткое объяснение для менеджера отдела закупа.
Полученные значения уже рассчитаны детерминированным модулем и являются единственным источником фактов.
Не пересчитывай, не исправляй и не округляй значения, не добавляй новые числа или причины.
Объясни по-русски в 2–4 предложениях, почему рекомендовано указанное количество, связав спрос, сезонность и рост с доступным остатком, резервом, товаром в пути и страховым запасом.`;

export type ReplenishmentNarrationInput = Pick<ReplenishmentRecommendation,
  "sku" | "productName" | "supplier" | "category" | "baseMonthlyDemand" | "seasonalIndex" |
  "historicalGrowthRate" | "forecastGrowthRate" | "stockoutAdjustmentUnitsPerMonth" | "stockoutMonths" |
  "excludedSpikeCount" | "excludedSpikeUnits" | "retainedGrowthSpikeCount" | "retainedGrowthSpikeUnits" |
  "spikeOrderImpactEstimate" | "currentStock" | "reservedStock" | "availableStock" |
  "goodsInTransitWithinHorizon" | "goodsInTransitUnknownEta" | "goodsInTransitAfterHorizon" |
  "etaAssumptionApplied" | "demandStdDev" | "serviceLevel" | "safetyStockZScore" | "safetyStock" |
  "targetPosition" | "currentPosition" | "recommendedOrder" | "urgency" | "demandPattern" |
  "nonZeroDemandFrequency" | "forecastMethod" | "exceptions"
>;

export interface ReplenishmentNarrationResult {
  narrative: string;
  source: "LLM" | "FALLBACK";
}

export interface NarrationTransportRequest {
  model: string;
  systemPrompt: string;
  recommendation: ReplenishmentNarrationInput;
  signal: AbortSignal;
}

export type NarrationTransport = (request: NarrationTransportRequest) => Promise<string>;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative"],
  properties: { narrative: { type: "string" } },
} as const;

const fallback = (): ReplenishmentNarrationResult => ({ narrative: "", source: "FALLBACK" });

export function isReplenishmentNarrationInput(value: unknown): value is ReplenishmentNarrationInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const strings = ["sku", "productName", "supplier", "category", "demandPattern", "forecastMethod"];
  const numbers = [
    "baseMonthlyDemand", "seasonalIndex", "historicalGrowthRate", "forecastGrowthRate",
    "stockoutAdjustmentUnitsPerMonth", "excludedSpikeCount", "excludedSpikeUnits", "retainedGrowthSpikeCount",
    "retainedGrowthSpikeUnits", "spikeOrderImpactEstimate", "currentStock", "reservedStock", "availableStock",
    "goodsInTransitWithinHorizon", "goodsInTransitUnknownEta", "goodsInTransitAfterHorizon", "demandStdDev", "serviceLevel",
    "safetyStockZScore", "safetyStock", "targetPosition", "currentPosition", "recommendedOrder", "nonZeroDemandFrequency",
  ];
  return strings.every((key) => typeof item[key] === "string" && item[key] !== "")
    && numbers.every((key) => typeof item[key] === "number" && Number.isFinite(item[key]))
    && Array.isArray(item.stockoutMonths) && item.stockoutMonths.every((month) => typeof month === "string")
    && typeof item.etaAssumptionApplied === "boolean"
    && Array.isArray(item.exceptions) && item.exceptions.every((exception) => typeof exception === "string")
    && ["high", "medium", "low"].includes(String(item.urgency));
}

async function openAiTransport(request: NarrationTransportRequest): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, logLevel: "off" });
  const response = await client.responses.create({
    model: request.model,
    store: false,
    reasoning: { effort: "minimal" },
    // Reasoning-model hidden reasoning tokens count against this same budget before any output is produced;
    // 500-600 was found to truncate structured output into invalid JSON in live testing elsewhere in this
    // project (see liveInvestigator.ts/liveSkeptic.ts/boundedRuntime/runtime.ts, all raised to 2000 for the
    // same reason) — matching that value here rather than re-discovering the same failure mode live.
    max_output_tokens: 2000,
    input: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: JSON.stringify({ recommendation: request.recommendation }) },
    ],
    text: { format: { type: "json_schema", name: "replenishment_narrative", strict: true, schema: OUTPUT_SCHEMA } },
  }, { signal: request.signal });
  return response.output_text;
}

/** The LLM may narrate these immutable figures, but never participates in their calculation. */
export async function narrateReplenishment(
  recommendation: ReplenishmentNarrationInput,
  transport?: NarrationTransport,
): Promise<ReplenishmentNarrationResult> {
  if (!isReplenishmentNarrationInput(recommendation) || (!transport && !process.env.OPENAI_API_KEY)) return fallback();
  const audit = createLlmAudit("REPLENISHMENT_NARRATOR");
  try {
    const output = await audit.request((signal) => (transport ?? openAiTransport)({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      systemPrompt: REPLENISHMENT_NARRATOR_SYSTEM_PROMPT,
      recommendation,
      signal,
    }));
    const parsed = JSON.parse(output) as { narrative?: unknown };
    if (typeof parsed.narrative !== "string" || !parsed.narrative.trim()) {
      audit.finish("INVALID_STRUCTURED_OUTPUT", "INVALID_STRUCTURED_OUTPUT");
      return fallback();
    }
    audit.finish();
    return { narrative: parsed.narrative.trim(), source: "LLM" };
  } catch {
    return fallback();
  }
}

type Narrate = (input: ReplenishmentNarrationInput) => Promise<ReplenishmentNarrationResult>;

/** Injectable HTTP handler keeps the route's expected fallback behavior unit-testable. */
export async function handleReplenishmentNarrationPost(
  request: Request,
  narrate: Narrate = narrateReplenishment,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(fallback(), { status: 400 });
  }
  if (!isReplenishmentNarrationInput(payload)) return Response.json(fallback(), { status: 400 });
  try {
    return Response.json(await narrate(payload), { status: 200 });
  } catch {
    return Response.json(fallback(), { status: 200 });
  }
}
