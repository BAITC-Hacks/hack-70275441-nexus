/**
 * Presentation-layer only: maps a canonical dataset column ID to a human-readable Russian label for
 * display in the Result narrative (headline, risk chain, evidence variables, recommendations).
 *
 * This is the single place that translation lives — components and report builders call `displayLabel`
 * instead of hardcoding a mapping themselves. It never renames the underlying field: `dataset.columns`,
 * `EvidenceRecord.variables`, tool inputs/outputs, and every computed value keep the canonical ID
 * (`schedule_gap_pp`, `usd_kzt`, ...) exactly as produced by the deterministic engine. Technical Trace and
 * the dataset configuration screens (which must show a user's own uploaded column names verbatim) read
 * canonical IDs directly and do not go through this helper.
 *
 * An ID with no known translation falls back to a generic prettified form (underscores to spaces, title
 * case) so an arbitrary uploaded dataset or an undocumented demo column never renders as `undefined`.
 */
const CONSTRUCTION_LABELS: Record<string, string> = {
  date: "Дата",
  planned_progress: "Плановый прогресс, %",
  actual_progress: "Фактический прогресс, %",
  schedule_gap_pp: "Отставание от графика, п.п.",
  usd_kzt: "Курс USD/KZT",
  estimate_material_price: "Сметная цена материалов",
  actual_material_price: "Фактическая цена материалов",
  planned_material_qty: "План закупки материалов, ед.",
  ordered_material_qty: "Заказано материалов, ед.",
  planned_delivery_qty: "План поставки материалов, ед.",
  actual_delivery_qty: "Факт поставки материалов, ед.",
  budget_available: "Доступный бюджет",
  procurement_required: "Требуемое финансирование закупок",
  procurement_shortfall: "Недостаток заказанных материалов",
  delivery_shortfall: "Недостаток поставленных материалов",
  schedule_gap: "Отставание от графика",
  price_gap: "Расхождение цены со сметой",
  workers: "Численность рабочих",
  contractor_productivity: "Производительность подрядчика",
  weather_disruption_hours: "Простои из-за погоды, ч",
};

const FINTECH_LABELS: Record<string, string> = {
  month: "Месяц",
  payment_delays: "Просроченные платежи",
  cash_flow: "Денежный поток",
  liquidity_stress: "Дефицит ликвидности",
  credit_utilization: "Загрузка кредитных лимитов",
  default_risk: "Кредитный риск",
  portfolio_risk: "Совокупный риск кредитного портфеля",
};

const DISPLAY_LABELS: Record<string, string> = { ...CONSTRUCTION_LABELS, ...FINTECH_LABELS };

const prettifyFallback = (id: string) => id.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());

/** Canonical field ID → human-readable label. Falls back to a prettified form for unmapped IDs. */
export function displayLabel(id: string): string {
  return DISPLAY_LABELS[id] ?? prettifyFallback(id);
}

/** Registry label for a known domain; retains the existing generic fallback. */
export function displayDomainLabel(id: string, domainId: string): string {
  return getMetricDefinition(domainId, id)?.labelRu ?? displayLabel(id);
}

/**
 * Renders a number string with a Russian decimal comma (`0.998` → `0,998`). Operates on the exact digits
 * already produced by the deterministic engine (e.g. via `.toFixed()`) — never recomputes or rounds
 * anything, only reformats the separator, so the underlying value is byte-for-byte preserved.
 */
export const ruDecimal = (numeric: string) => numeric.replace(".", ",");

/**
 * Shared Russian phrasing for the Skeptic verdict enum, kept in the same place as every other
 * canonical-ID → display-text mapping so the web Result page and the PDF report render the identical
 * business-facing status text instead of each hardcoding their own. The technical enum value stays visible
 * in parentheses (allowed to remain, per the language-consistency fix, as a technical status marker).
 */
const STATUS_LABELS: Record<"SUPPORTED" | "CHALLENGED" | "INCONCLUSIVE", string> = {
  SUPPORTED: "Подтверждена (SUPPORTED)",
  CHALLENGED: "Оспорена (CHALLENGED)",
  INCONCLUSIVE: "Неопределённый результат (INCONCLUSIVE)",
};

export const statusLabel = (status: "SUPPORTED" | "CHALLENGED" | "INCONCLUSIVE"): string => STATUS_LABELS[status];

/**
 * Russian phrasing for the fixed English sentence *tails* the generic tools in `lib/nexus/agentic/toolRegistry.ts`
 * produce, once their leading `"<id>: "` or `"<left> ↔ <right>: "` prefix has already been relabeled.
 * Each entry is `[pattern-to-match-the-English-tail, Russian-builder-from-the-captured-numbers]`. A tail
 * that doesn't match any of these (LLM free text, an unmapped tool, or a future tool with no Russian
 * template yet) is returned unchanged — this never guesses at a translation.
 */
const TAIL_TRANSLATIONS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  // inspect_series: "latest 12.30, mean 11.05, standard deviation 0.62."
  [/^latest (-?[\d.]+), mean (-?[\d.]+), standard deviation (-?[\d.]+)\.$/, (m) => `последнее значение ${ruDecimal(m[1])}, среднее ${ruDecimal(m[2])}, стандартное отклонение ${ruDecimal(m[3])}.`],
  // calculate_correlation: "correlation 0.998 over 24 paired observations."
  [/^correlation (-?[\d.]+) over (\d+) paired observations\.$/, (m) => `корреляция ${ruDecimal(m[1])} по ${m[2]} парным наблюдениям.`],
  // calculate_correlation (insufficient data): "correlation not computed — only 1 paired observations (minimum 3 required)."
  [/^correlation not computed — only (\d+) paired observations \(minimum 3 required\)\.$/, (m) => `корреляция не рассчитана — только ${m[1]} парных наблюдений (требуется минимум 3).`],
  // detect_outliers: "3 observations meet the descriptive |z| ≥ 1.5 outlier rule."
  [/^(\d+) observations meet the descriptive \|z\| ≥ 1\.5 outlier rule\.$/, (m) => `${m[1]} наблюдений соответствуют описательному правилу выбросов |z| ≥ 1,5.`],
  // inspect_missingness: "0 missing values."
  [/^(\d+) missing values\.$/, (m) => `пропущенных значений: ${m[1]}.`],
  // inspect_directional_movement: "5/5 recent adjacent movements were non-decreasing."
  [/^(\d+)\/(\d+) recent adjacent movements were non-decreasing\.$/, (m) => `${m[1]} из ${m[2]} последних смежных изменений были неснижающимися.`],
];

/**
 * Russian phrasing for the fixed English sentences the construction tool pack
 * (`lib/nexus/construction/tools.ts`) and `profile_dataset` produce with no `"<id>: "` prefix at all —
 * tried against the whole string. Same never-guess rule: no match, no change.
 */
const FULL_SENTENCE_TRANSLATIONS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Schedule gap (-?[\d.]+) percentage points; recent widening (-?[\d.]+)\.$/, (m) => `Отставание от графика: ${ruDecimal(m[1])} п.п.; недавнее увеличение — ${ruDecimal(m[2])}.`],
  [/^Schedule deviation widened in (\d+)\/5 recent intervals\.$/, (m) => `Отклонение от графика увеличивалось в ${m[1]} из 5 последних интервалов.`],
  [/^Delivery shortfall (-?[\d.]+) units \((-?[\d.]+)%\)\.$/, (m) => `Недопоставка: ${ruDecimal(m[1])} ед. (${ruDecimal(m[2])}%).`],
  [/^Procurement shortfall (-?[\d.]+) units\.$/, (m) => `Дефицит закупок: ${ruDecimal(m[1])} ед.`],
  [/^Material price variance (-?[\d.]+) \((-?[\d.]+)%\)\.$/, (m) => `Отклонение цены материалов: ${ruDecimal(m[1])} (${ruDecimal(m[2])}%).`],
  [/^Procurement funding gap (-?[\d.]+)\.$/, (m) => `Дефицит финансирования закупок: ${ruDecimal(m[1])}.`],
  [/^USD\/KZT changed from (-?[\d.]+) to (-?[\d.]+) \((-?[\d.]+)%\)\.$/, (m) => `Курс USD/KZT изменился с ${ruDecimal(m[1])} до ${ruDecimal(m[2])} (${ruDecimal(m[3])}%).`],
  [/^Observed ordering is FX movement, price divergence, procurement pressure, delivery shortfall, then schedule deterioration\.$/, () => "Наблюдаемая последовательность: изменение курса, расхождение цен, давление на закупки, недопоставка материалов, затем ухудшение графика."],
  [/^Alternative factors show no comparably sustained deterioration in the observed period\.$/, () => "Альтернативные факторы не показывают сопоставимого устойчивого ухудшения за наблюдаемый период."],
  [/^(\d+) observations, (\d+) columns, (\d+) numeric columns\.$/, (m) => `${m[1]} наблюдений, ${m[2]} колонок, ${m[3]} числовых колонок.`],
];

const translateAgainst = (text: string, table: Array<[RegExp, (match: RegExpMatchArray) => string]>): string => {
  for (const [pattern, build] of table) {
    const match = text.match(pattern);
    if (match) return build(match);
  }
  return text;
};

/** The tail of a `"<id>: <tail>"` or `"<left> ↔ <right>: <tail>"` deterministic evidence sentence, translated to Russian if a known template matches — otherwise returned unchanged. */
const translateSentenceTail = (tail: string): string => translateAgainst(tail, TAIL_TRANSLATIONS);

/** A whole deterministic evidence sentence with no `"<id>: "` prefix, translated to Russian if a known template matches — otherwise returned unchanged. */
const translateDeterministicSentence = (text: string): string => translateAgainst(text, FULL_SENTENCE_TRANSLATIONS);

/**
 * Tool-output sentences from the deterministic engine (e.g. `inspect_directional_movement`) follow the
 * fixed shape `"<canonicalId>: <sentence>"` — see `lib/nexus/agentic/toolRegistry.ts` and
 * `lib/nexus/construction/tools.ts`. This rewrites the leading identifier to its display label, and — when
 * the sentence that follows matches one of the known deterministic-tool templates above — renders that
 * sentence in natural Russian with its numbers preserved exactly (only the decimal separator changes). A
 * sentence with no leading identifier (the construction tool pack's shape) is matched against the same
 * template table directly. Anything that matches no known template (free LLM text, an unmapped tool) is
 * returned unchanged — this never guesses at a translation. The original string (as stored on the
 * EvidenceRecord) is never mutated — this operates on a copy used only for display.
 */
function relabelFieldPrefixWith(text: string, label: (id: string) => string): string {
  const match = text.match(/^([A-Za-z][A-Za-z0-9_]*): ([\s\S]*)$/);
  if (!match) return translateDeterministicSentence(text);
  const [, id, rest] = match;
  return `${label(id)}: ${translateSentenceTail(rest)}`;
}

export function relabelFieldPrefix(text: string): string {
  return relabelFieldPrefixWith(text, displayLabel);
}

/**
 * Same idea as `relabelFieldPrefix`, extended to the second fixed shape a deterministic tool output can
 * take: `"<leftId> ↔ <rightId>: <sentence>"` (see `calculate_correlation` in `lib/nexus/agentic/toolRegistry.ts`).
 * Tries the pair form first (translating its tail the same way `relabelFieldPrefix` does), then falls back
 * to the single-ID form. Used only where a raw `EvidenceRecord.result` string is rendered as user-facing
 * content (evidence cards, the Observer summary, the PDF report) — Technical Trace reads `result` directly
 * and does not go through this helper.
 */
function relabelEvidenceSummaryWith(text: string, label: (id: string) => string): string {
  const pairMatch = text.match(/^([A-Za-z][A-Za-z0-9_]*) ↔ ([A-Za-z][A-Za-z0-9_]*): ([\s\S]*)$/);
  if (pairMatch) {
    const [, left, right, rest] = pairMatch;
    return `${label(left)} ↔ ${label(right)}: ${translateSentenceTail(rest)}`;
  }
  return relabelFieldPrefixWith(text, label);
}

export function relabelEvidenceSummary(text: string): string {
  return relabelEvidenceSummaryWith(text, displayLabel);
}

/** Domain Registry labels for business-facing Evidence; raw Evidence remains unchanged. */
export function relabelDomainEvidenceSummary(text: string, domainId: string): string {
  return relabelEvidenceSummaryWith(text, id => displayDomainLabel(id, domainId));
}
/** Presentation aliases only; canonical Domain Pack unit identifiers remain unchanged. */
export function displayUnit(unit?: string): string {
  return unit === "pp" ? "п.п." : unit === "material units" ? "ед." : unit ?? "";
}
import { getMetricDefinition } from "../domains/registry.ts";
