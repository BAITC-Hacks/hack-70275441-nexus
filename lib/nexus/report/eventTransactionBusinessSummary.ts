import type { EventTransactionAnalysis } from "../eventTransaction/types.ts";
import type { HumanBusinessSummary } from "./crossSectionalBusinessSummary.ts";
const number = (value: number) => value.toLocaleString("ru-RU");

/** Verbalizes existing event analysis, without calculating new rankings. */
export function buildEventTransactionBusinessSummary(analysis: EventTransactionAnalysis): HumanBusinessSummary {
  return {
    headline: `Проанализировано ${number(analysis.dataset.eventCount)} событий; ${number(analysis.detection.notableEvents.length)} соответствуют заданным правилам внимания.`,
    whyItMatters: "Результат выделяет события для проверки качества регистрации и контекста операций.",
    findings: [`Обнаружено ${number(analysis.timing.bursts.length)} групп близких по времени событий и ${number(analysis.detection.repeatedPatterns.length)} повторяющихся шаблонов.`, ...(!analysis.semantics.entityColumn ? ["Идентификатор участника отсутствует: события объединены в общую группу, которая не обозначает одного человека или организацию."] : [])],
    uncertainty: ["Эти правила не устанавливают мошенничество, атаку или сбой. Причинная связь не доказана; пакетная загрузка и дублирование могут объяснять наблюдения."],
    nextSteps: ["Проверьте выделенные события по исходным записям и контексту операций перед дальнейшими решениями."],
  };
}
