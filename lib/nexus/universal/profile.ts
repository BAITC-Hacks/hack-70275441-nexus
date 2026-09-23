import type { UploadedDataset } from "../ingestion/types.ts";
import type { ShapeProfile } from "./contracts.ts";
import { normalizeHeader, normalizeHeaders } from "./headers.ts";
import { isNumericCell } from "../ingestion/numericSeries.ts";

// Russian equivalents cover only the words with no entry in headers.ts's EVENT_TIMESTAMP alias list
// (period/month/week have no Russian alias there; date/time already match via normalizeHeader's roles).
const timeHint = /^(date|time|timestamp|period|month|week|observation_date|дата|время|период|месяц|неделя)$/i;
const entityHint = /(^id$|_id$|^id_|client|customer|account|entity)/i;
const isMissingCell = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** Explicit calendar formats only: numbers are never interpreted as epoch dates. */
export function periodTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const week = /^(\d{4})-W(\d{2})$/.exec(value);
  if (week) {
    const year = Number(week[1]), w = Number(week[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (w - 1) * 604800000;
    return w >= 1 && w <= 53 && new Date(monday + 3 * 86400000).getUTCFullYear() === year ? monday : null;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) { const parsed = Date.parse(`${value}-01T00:00:00Z`); return Number(month[2]) >= 1 && Number(month[2]) <= 12 ? parsed : null; }
  // DD.MM.YYYY / DD/MM/YYYY — day-month order only (never month-day), matching how this data is
  // exported by 1C/Excel in the ru-RU/kk-KZ locales this UI targets. Never ambiguous with the ISO
  // branch below, which requires dash separators.
  const dayFirst = /^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/.exec(value);
  if (dayFirst) {
    const day = Number(dayFirst[1]), monthIndex = Number(dayFirst[3]) - 1, year = Number(dayFirst[4]);
    const date = new Date(Date.UTC(year, monthIndex, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex && date.getUTCDate() === day ? date.getTime() : null;
  }
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!calendar) return null;
  const year = Number(calendar[1]), monthIndex = Number(calendar[2]) - 1, day = Number(calendar[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  if (!calendar[4]) return date.getTime();
  const hour = Number(calendar[4]), minute = Number(calendar[5]), second = Number(calendar[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const normalized = `${calendar[1]}-${calendar[2]}-${calendar[3]}T${calendar[4]}:${calendar[5]}:${calendar[6]}${calendar[7] ? `.${calendar[7]}` : ""}${calendar[8] || "Z"}`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function profileShape(dataset: UploadedDataset, selectedDate?: string): ShapeProfile {
  const rows = dataset.rows;
  const roles = new Map(normalizeHeaders(dataset.columns).map((header) => [header.originalName, header.semanticRole]));
  // A column counts as a measure when every PRESENT cell is numeric and at least one is; a missing
  // cell here or there does not disqualify it — the correlation/precursor engine already skips a
  // missing observation row-by-row (see numericSeries.ts) rather than requiring whole-column coverage.
  const measures = dataset.columns.filter((column) => !["EVENT_ID", "EVENT_TIMESTAMP", "ENTITY_ID"].includes(roles.get(column)!) && !entityHint.test(column) && !timeHint.test(column) && rows.length > 0 && rows.some((row) => isNumericCell(row[column])) && rows.every((row) => isMissingCell(row[column]) || isNumericCell(row[column])));
  const identities = dataset.columns.filter((column) => (normalizeHeader(column).semanticRole === "ENTITY_ID" || entityHint.test(column)) && rows.length > 0 && rows.every((row) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== "") && new Set(rows.map((row) => String(row[column]))).size === rows.length);
  const candidates = dataset.columns.filter((column) => (roles.get(column) === "EVENT_TIMESTAMP" || timeHint.test(column) || column === selectedDate) && rows.length > 0 && rows.every((row) => periodTime(row[column]) !== null));
  const timeColumn = selectedDate ? candidates.find((column) => column === selectedDate) : candidates.length === 1 ? candidates[0] : undefined;
  const times = timeColumn ? rows.map((row) => periodTime(row[timeColumn])!) : [];
  const ordered = times.length >= 3 && times.every((time, index) => index === 0 || time > times[index - 1]);
  const eventIdentity = dataset.columns.some((column) => roles.get(column) === "EVENT_ID" && rows.every((row) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== ""));
  const eventEntity = dataset.columns.some((column) => roles.get(column) === "ENTITY_ID" && rows.every((row) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== ""));
  const eventType = dataset.columns.some((column) => roles.get(column) === "EVENT_TYPE" && rows.every((row) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== ""));
  if (timeColumn && eventType && (eventIdentity || eventEntity)) return { tag: "EVENT_TRANSACTION", support: "CONFIRMED", timeColumn, measures, reasons: ["Каждая строка имеет смысл события/действия, корректную метку времени и идентификатор события или сущности."], missingRequirements: [] };
  if (identities.length && !eventType && !eventIdentity) return { tag: "CROSS_SECTIONAL", support: "CONFIRMED", timeColumn, measures, reasons: ["Именованный идентификатор сущности уникален для каждой строки; смысл наблюдения во времени не установлен."], missingRequirements: [] };
  if (ordered && measures.length && !eventType && !eventIdentity && !eventEntity) return { tag: "TIME_SERIES", support: "CONFIRMED", timeColumn, measures, reasons: ["Подтверждённая колонка периода строго возрастает, есть минимум три различных наблюдения и числовые показатели; конфликта с уникальной сущностью или смыслом строки-события нет."], missingRequirements: [] };
  return { tag: "AMBIGUOUS_TABULAR", support: "AMBIGUOUS", timeColumn, measures, reasons: ["Структура данных не позволяет однозначно определить смысл строки."], missingRequirements: [
    ...(!timeColumn ? ["Если строки представляют события или наблюдения во времени, укажите одну корректную колонку с календарной меткой времени."] : []),
    ...(!measures.length ? ["Укажите числовой показатель с конечными наблюдениями."] : []),
    "Уточните, чем является каждая строка — событием, сущностью или наблюдением во времени; для событий нужны время, тип и идентификатор события или сущности.",
  ] };
}
