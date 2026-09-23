import { runAgenticInvestigation } from "@/lib/nexus/agentic/orchestrator";
import type { InvestigationProgress } from "@/lib/nexus/agentic/types";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import { admitInvestigation, executeAdmitted } from "@/lib/nexus/universal/admission";
import { runCrossSectionalInvestigation } from "@/lib/nexus/crossSectional/workflow";
import { runEventTransactionInvestigation } from "@/lib/nexus/eventTransaction/workflow";
import { createTimeSeriesArtifact, validateTimeSeriesArtifact } from "@/lib/nexus/timeSeries/validator";
import { resolveRuntimeToolPackScenario } from "@/lib/nexus/tasks/taskRegistry";

type InvestigationRequest = {
  dataset: UploadedDataset;
  signals: string[];
  domain: string;
  objective?: string;
  taskId?: string;
  intent?: string;
  mapping: { date?: string; target?: string };
};

const MIN_ROWS_FOR_INVESTIGATION = 3;

const encoder = new TextEncoder();
const event = (type: "progress" | "result" | "error", data: unknown) =>
  encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(request: Request) {
  let body: InvestigationRequest;
  try {
    body = (await request.json()) as InvestigationRequest;
  } catch {
    return Response.json({ error: "NEXUS не смог прочитать запрос на расследование." }, { status: 400 });
  }
  if (!body || !Array.isArray(body.dataset?.rows) || !body.dataset.rows.length || !Array.isArray(body.dataset.columns) || body.dataset.columns.some((column) => typeof column !== "string") || body.dataset.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    return Response.json({ error: "В этом наборе данных нет строк для расследования. Загрузите файл, который содержит наблюдения." }, { status: 400 });
  }
  if (!Array.isArray(body.signals)) {
    return Response.json({ error: "Не выбраны сигналы. Выберите хотя бы одну числовую колонку для расследования." }, { status: 400 });
  }
  if (body.dataset.rows.length < MIN_ROWS_FOR_INVESTIGATION) {
    return Response.json({ error: `NEXUS требуется минимум ${MIN_ROWS_FOR_INVESTIGATION} записи для ограниченного расследования. В этом наборе данных их ${body.dataset.rows.length}.` }, { status: 400 });
  }

  const admissionRequest = { dataset: body.dataset, signals: body.signals, mapping: body.mapping, taskId: body.taskId, intent: body.intent };
  const routeDecision = admitInvestigation(admissionRequest);
  if (body.signals.length === 0 && routeDecision.shape.tag !== "EVENT_TRANSACTION") {
    return Response.json({ error: "Не выбраны сигналы. Выберите хотя бы одну числовую колонку для расследования." }, { status: 400 });
  }
  if (routeDecision.status !== "PROCEED") {
    return Response.json({ ...routeDecision, routeDecision, error: [...routeDecision.reasons, ...routeDecision.missingRequirements].join(" ") }, { status: 422 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendProgress = (progress: InvestigationProgress) =>
        controller.enqueue(event("progress", progress));
      try {
        if (routeDecision.workflowId === "cross-sectional-investigation") {
          const result = await runCrossSectionalInvestigation({ dataset: body.dataset, signals: body.signals, target: body.mapping?.target, objective: body.objective, taskId: body.taskId, onProgress: sendProgress });
          controller.enqueue(event("result", result));
          return;
        }
        if (routeDecision.workflowId === "event-transaction-investigation") {
          const result = await runEventTransactionInvestigation({ dataset: body.dataset, signals: body.signals, objective: body.objective, taskId: body.taskId, onProgress: sendProgress });
          controller.enqueue(event("result", result));
          return;
        }
        const { analysis, agentic } = await executeAdmitted(admissionRequest, () => runAgenticInvestigation(
          body.dataset,
          body.signals,
          sendProgress,
          body.mapping?.target,
          resolveRuntimeToolPackScenario(body.taskId, body.domain),
          body.objective,
          body.mapping?.date,
          body.domain,
        ));
        const artifact = createTimeSeriesArtifact(admissionRequest, { analysis, precursorChain: agentic.precursorChain });
        const validation = validateTimeSeriesArtifact(admissionRequest, artifact);
        if (validation.status !== "VALIDATED") {
          controller.enqueue(event("error", { error: "Детерминированная валидация TIME_SERIES не пройдена.", validation }));
          return;
        }
        const fallbackReason = (reason?: string) => reason === "MISSING_API_KEY" ? "missing_api_key" as const : reason === "TIMEOUT" ? "timeout" as const : reason === "INVALID_STRUCTURED_OUTPUT" ? "invalid_response" as const : "api_error" as const;
        const investigator = {
          runtime: agentic.investigator.runtime,
          output: {
            hypothesis: agentic.hypothesis.primary,
            alternative_explanation: agentic.hypothesis.alternative,
            reasoning: agentic.hypothesis.limitations.join(" "),
          },
          source: agentic.investigator.source === "LLM" ? ("openai" as const) : ("fallback" as const),
          ...(agentic.investigator.source === "FALLBACK"
            ? { fallbackReason: fallbackReason(agentic.investigator.runtime?.fallbackReason) }
            : {}),
        };
        const validator = {
          runtime: agentic.skeptic.runtime,
          output: {
            challenge: agentic.skepticReview.challenge,
            alternative_explanations: agentic.skepticReview.alternatives,
            validation_reasoning: agentic.finalAssessment,
            status: "inconclusive" as const,
          },
          source: agentic.skeptic.source === "LLM" ? ("openai" as const) : ("fallback" as const),
          ...(agentic.skeptic.source === "FALLBACK"
            ? { fallbackReason: fallbackReason(agentic.skeptic.runtime?.fallbackReason) }
            : {}),
        };
        controller.enqueue(event("result", { kind: "TIME_SERIES", artifact, validation, analysis, investigator, validator, agentic }));
      } catch {
        controller.enqueue(event("error", { error: "NEXUS не смог безопасно выполнить это расследование." }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
