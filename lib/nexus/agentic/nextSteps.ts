import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import type { PrecursorChain } from "./types";
import { displayDomainLabel, displayLabel } from "../report/displayLabels.ts";

const SUFFICIENT_OBSERVATIONS = 30;
const HIGH_MISSING_PERCENT = 10;

/**
 * Deterministic "what to check next" list — every line is derived from an already-computed number
 * (observation count, missing%, risk label). This intentionally does not ask the LLM to guess a
 * recommendation, to avoid the same "invented number" problem as a fitted risk score.
 *
 * `domainId` only changes which label a column name resolves to (Domain Registry when known, the
 * existing generic prettifier otherwise) — it selects none of the steps, columns or their order.
 */
export function buildNextSteps(dataset: UploadedDataset, analysis: GenericAnalysis, chain: PrecursorChain, domainId?: string): string[] {
  const label = (column: string) => domainId ? displayDomainLabel(column, domainId) : displayLabel(column);
  const steps: string[] = [];

  if (dataset.rows.length < SUFFICIENT_OBSERVATIONS) {
    steps.push(`Соберите больше наблюдений, прежде чем считать эту картину устойчивой: доступно ${dataset.rows.length} строк, рекомендуется ${SUFFICIENT_OBSERVATIONS}+.`);
  }

  const columnsInChain = new Set(chain.edges.flatMap((edge) => [edge.from, edge.to]));
  analysis.profile.columns
    .filter((column) => columnsInChain.has(column.name) && column.missingPercent > HIGH_MISSING_PERCENT)
    .forEach((column) => steps.push(`Проверьте качество данных по показателю "${label(column.name)}", прежде чем доверять этой связи — ${column.missingPercent.toFixed(0)}% значений отсутствуют.`));

  if (chain.edges.length === 0) {
    steps.push("Числовой опережающий сигнал не обнаружен — выберите дополнительные числовые столбцы или другой целевой показатель и запустите расследование заново.");
  } else if (chain.riskLabel === "HIGH") {
    steps.push(`Приоритезируйте ручную проверку по показателям: ${chain.edges.map((edge) => label(edge.from)).join(", ")} — они демонстрируют наиболее сильную вычисленную связь с итоговым показателем, но корреляция не подтверждает причинно-следственную связь.`);
  } else if (chain.riskLabel === "LOW") {
    steps.push("Устойчивый опережающий паттерн в текущем окне не обнаружен — повторите расследование, когда появятся более новые наблюдения.");
  }

  steps.push("Это ранжированный список того, что стоит проверить дальше, а не автоматическое решение — следующий шаг расследования должен сделать человек, оценив отмеченные сигналы.");
  return steps;
}
