import type { CrossSectionalAnalysis } from "../crossSectional/types.ts";
import { displayLabel } from "./displayLabels.ts";

export type HumanBusinessSummary = { headline: string; whyItMatters: string; findings: string[]; uncertainty: string[]; nextSteps: string[] };
const number = (value: number) => value.toLocaleString("ru-RU");

/** Pure presentation of computed facts; no model, network or new decision rule. */
export function buildCrossSectionalBusinessSummary(analysis: CrossSectionalAnalysis): HumanBusinessSummary {
  const top = analysis.drivers[0];
  return {
    headline: top ? `Наиболее выраженная из рассчитанных связей — между «${displayLabel(top.predictor)}» и «${displayLabel(top.target)}». Она рассчитана по ${number(top.n)} наблюдениям.` : `Проанализировано ${number(analysis.dataset.entityCount)} независимых записей. Связи с итоговым показателем не ранжированы.`,
    whyItMatters: analysis.highRisk.entities.length ? `${number(analysis.highRisk.entities.length)} записей соответствуют заданному правилу отбора и требуют проверки исходных данных.` : "Результат описывает различия между записями; он помогает выбрать, что проверить дальше.",
    findings: [`В анализ включено ${number(analysis.dataset.entityCount)} записей. Порядок строк не использовался как время.`, analysis.target.column ? `Итоговый показатель: «${displayLabel(analysis.target.column)}».` : "Подтверждённый итоговый показатель отсутствует; доступно только описание данных.", `Рассчитано ${number(analysis.associations.length)} связей между признаками.`],
    uncertainty: ["Связь не доказывает причинную зависимость и не устанавливает, что произошло раньше. Итоговый показатель может сам использовать исследованные признаки; состав выборки и пропуски также могут объяснять различия."],
    nextSteps: [analysis.highRisk.entities.length ? "Проверьте отобранные записи и происхождение итогового показателя перед решением о вмешательстве." : "Проверьте происхождение итогового показателя и полноту данных перед дальнейшими решениями."],
  };
}
