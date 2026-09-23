import type { AdmissionRequest, RouteDecision, TaskIntent } from "./contracts.ts";
import { profileShape } from "./profile.ts";
import { crossSectionalWorkflow, eventTransactionWorkflow, genericTimeSeriesWorkflow } from "./workflow.ts";

export function admitInvestigation(request: AdmissionRequest): RouteDecision {
  const shape = profileShape(request.dataset, request.mapping?.date);
  const intent = (["ANALYZE", "INVESTIGATE", "SCORE"].includes(request.intent ?? "INVESTIGATE") ? request.intent ?? "INVESTIGATE" : null) as TaskIntent | null;
  const base = { shape, intent, reasons: [...shape.reasons], missingRequirements: [...shape.missingRequirements], compatibilityRuleIds: ["TS-CONFIRMED-AXIS", "TS-ORDERED-PERIODS", "TS-ROW-SEMANTICS", "TS-NUMERIC-MEASURES", "TS-MINIMUM-SAMPLE"] };
  if (!intent || !["generic", "fintech", "construction", "synthetic", "event-activity"].includes(request.taskId ?? "generic")) return { ...base, status: "UNSUPPORTED", reasons: ["Неизвестная задача или намерение; рабочий процесс не выбран."], compatibilityRuleIds: ["KNOWN-TASK-ONLY"] };
  if (intent !== genericTimeSeriesWorkflow.intent) return { ...base, status: "UNSUPPORTED", reasons: [`Выполнение «${intent}» не реализовано в Universal Kernel Stage 2A.`] };
  if (shape.tag === "CROSS_SECTIONAL" && request.dataset.rows.length < crossSectionalWorkflow.minimumObservations) return { ...base, status: "NEEDS_INPUT", missingRequirements: [`Укажите минимум ${crossSectionalWorkflow.minimumObservations} записей сущностей для расследования поперечного среза.`], compatibilityRuleIds: ["CS-MINIMUM-SAMPLE"] };
  if (shape.tag === "CROSS_SECTIONAL") return {
    ...base,
    status: "PROCEED",
    workflowId: crossSectionalWorkflow.id,
    reasons: ["NEXUS определил одну сущность на строку и выбрал расследование поперечного среза. Возможности временных рядов недоступны."],
    missingRequirements: [],
    compatibilityRuleIds: ["CS-ENTITY-ROWS", "CS-MINIMUM-SAMPLE", "CS-NO-TEMPORAL-TOOLS"],
  };
  if (shape.tag === "EVENT_TRANSACTION" && request.dataset.rows.length < eventTransactionWorkflow.minimumObservations) return { ...base, status: "NEEDS_INPUT", missingRequirements: [`Укажите минимум ${eventTransactionWorkflow.minimumObservations} записей событий для расследования событий.`], compatibilityRuleIds: ["EVENT-MINIMUM-SAMPLE"] };
  if (shape.tag === "EVENT_TRANSACTION") return { ...base, status: "PROCEED", workflowId: eventTransactionWorkflow.id, reasons: ["NEXUS определил одно событие или транзакцию на строку и выбрал расследование событий/транзакций."], missingRequirements: [], compatibilityRuleIds: ["EVENT-ROW-SEMANTICS", "EVENT-TIMESTAMP", "EVENT-TYPE", "EVENT-IDENTITY", "EVENT-MINIMUM-SAMPLE", "EVENT-NO-TEMPORAL-SERIES-TOOLS", "EVENT-NO-CROSS-SECTIONAL-TOOLS"] };
  if (shape.tag !== "TIME_SERIES") return { ...base, status: "NEEDS_INPUT" };
  if (!request.signals.length || request.signals.some((column) => !shape.measures.includes(column)) || request.mapping?.target && !shape.measures.includes(request.mapping.target)) return { ...base, status: "NEEDS_INPUT", missingRequirements: ["Выберите числовые показатели для каждого сигнала и итогового значения; идентификаторы и даты не могут быть показателями."] };
  return { ...base, status: "PROCEED", workflowId: genericTimeSeriesWorkflow.id };
}

/** Callback is only entered for the admitted time-series workflow. Cross-sectional PROCEED cannot cross this boundary. */
export function executeAdmitted<T>(request: AdmissionRequest, execute: () => T): T {
  const route = admitInvestigation(request);
  if (route.status !== "PROCEED" || route.workflowId !== genericTimeSeriesWorkflow.id) throw new Error(`${route.status}: ${[...route.reasons, ...route.missingRequirements].join(" ")}`);
  return execute();
}
