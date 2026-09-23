import { pearsonCorrelation } from "../../engine/statistics.ts";
import { isNumericCell, numericPairs, numericSeries } from "../ingestion/numericSeries.ts";
import { profileDataset } from "../ingestion/profileDataset.ts";
import type { CellValue, UploadedDataset } from "../ingestion/types.ts";
import type { CrossSectionalAnalysis, CrossSectionalAssociation, CrossSectionalFixtureMetadata, CategoricalSummary, HighRiskEntity, NumericSummary, TargetResolution } from "./types.ts";
import { findColumnByRole, normalizeHeader } from "../universal/headers.ts";

const identityHint = /(^id$|_id$|^id_|client|customer|account|entity)/i;
const targetAliases = ["risk_score", "default_flag", "churn_flag", "risk_category"];
const round = (value: number) => Math.round(value * 1e12) / 1e12;
const present = (value: CellValue | undefined) => value !== null && value !== undefined && value !== "";

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function stableHash(value: unknown): string {
  const text = stableStringify(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function entityColumn(dataset: UploadedDataset): string {
  return dataset.columns.find((column) => (normalizeHeader(column).semanticRole === "ENTITY_ID" || identityHint.test(column)) && dataset.rows.every((row) => present(row[column])) && new Set(dataset.rows.map((row) => String(row[column]))).size === dataset.rows.length) ?? "__source_row__";
}

export function resolveTarget(dataset: UploadedDataset, explicit?: string): TargetResolution {
  const profile = profileDataset(dataset);
  const resolve = (column: string, source: TargetResolution["source"]): TargetResolution | null => {
    if (!dataset.columns.includes(column) || identityHint.test(column)) return null;
    const kind = profile.numericColumns.includes(column) ? "NUMERIC" : profile.categoricalColumns.includes(column) ? "CATEGORICAL" : null;
    return kind ? { column, source, kind, authoritative: true, reason: source === "EXPLICIT" ? "Target was explicitly selected by the user." : `Target matched the safe known alias ${column}.` } : null;
  };
  if (explicit) return resolve(explicit, "EXPLICIT") ?? { column: null, source: "NONE", kind: null, authoritative: false, reason: "The selected target is absent, an identifier, or unsupported." };
  for (const role of ["TARGET_NUMERIC", "TARGET_CATEGORY"] as const) { const actual = findColumnByRole(dataset.columns, role); const found = actual && resolve(actual, "KNOWN_ALIAS"); if (found) return found; }
  for (const alias of targetAliases) { const actual = dataset.columns.find((column) => column.toLowerCase() === alias); const found = actual && resolve(actual, "KNOWN_ALIAS"); if (found) return found; }
  return { column: null, source: "NONE", kind: null, authoritative: false, reason: "No explicit target or safe known target alias was confirmed." };
}

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
export function summarizeNumericColumns(dataset: UploadedDataset): NumericSummary[] {
  const id = entityColumn(dataset);
  return profileDataset(dataset).numericColumns.filter((column) => column !== id).map((column) => {
    const values = numericSeries(dataset.rows, column); const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { column, count: values.length, missing: dataset.rows.length - values.length, min: Math.min(...values), max: Math.max(...values), mean: round(mean), median: round(median(values)), standardDeviation: round(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)) };
  });
}

export function summarizeCategoricalColumns(dataset: UploadedDataset): CategoricalSummary[] {
  const id = entityColumn(dataset);
  return profileDataset(dataset).categoricalColumns.filter((column) => column !== id).map((column) => {
    const counts = new Map<string, number>(); let missing = 0;
    for (const row of dataset.rows) { if (!present(row[column])) { missing += 1; continue; } const value = String(row[column]); counts.set(value, (counts.get(value) ?? 0) + 1); }
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { column, count: dataset.rows.length - missing, missing, distinct: values.length, values };
  });
}

export function calculateAssociations(dataset: UploadedDataset, target: TargetResolution): CrossSectionalAssociation[] {
  if (!target.column || !target.kind) return [];
  const profile = profileDataset(dataset); const id = entityColumn(dataset); const result: CrossSectionalAssociation[] = [];
  if (target.kind === "NUMERIC") {
    const targetValues = numericSeries(dataset.rows, target.column); const mean = targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length;
    const targetSd = Math.sqrt(targetValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / targetValues.length);
    for (const predictor of profile.numericColumns.filter((column) => column !== target.column && column !== id)) {
      const pairs = numericPairs(dataset.rows, predictor, target.column); if (pairs.length < 3) continue;
      const value = round(pearsonCorrelation(pairs.map(([left]) => left), pairs.map(([, right]) => right)));
      result.push({ predictor, target: target.column, method: "PEARSON", n: pairs.length, value, absoluteStrength: Math.abs(value), causality: "NOT_ESTABLISHED" });
    }
    for (const predictor of profile.categoricalColumns.filter((column) => column !== id)) {
      const groups = new Map<string, number[]>();
      for (const row of dataset.rows) if (present(row[predictor]) && isNumericCell(row[target.column])) { const key = String(row[predictor]); groups.set(key, [...(groups.get(key) ?? []), Number(row[target.column])]); }
      const summaries = [...groups].map(([value, values]) => ({ value, count: values.length, targetMean: round(values.reduce((sum, item) => sum + item, 0) / values.length) })).sort((a, b) => a.value.localeCompare(b.value));
      if (summaries.length > 1) { const range = Math.max(...summaries.map((group) => group.targetMean)) - Math.min(...summaries.map((group) => group.targetMean)); result.push({ predictor, target: target.column, method: "GROUP_MEAN_RANGE", n: summaries.reduce((sum, group) => sum + group.count, 0), absoluteStrength: round(targetSd ? range / targetSd : 0), groups: summaries, causality: "NOT_ESTABLISHED" }); }
    }
  } else {
    for (const predictor of profile.numericColumns.filter((column) => column !== id)) {
      const groups = new Map<string, number[]>(); const values = numericSeries(dataset.rows, predictor); const mean = values.reduce((sum, value) => sum + value, 0) / values.length; const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      for (const row of dataset.rows) if (present(row[target.column]) && isNumericCell(row[predictor])) { const key = String(row[target.column]); groups.set(key, [...(groups.get(key) ?? []), Number(row[predictor])]); }
      const summaries = [...groups].map(([value, group]) => ({ value, count: group.length, predictorMean: round(group.reduce((sum, item) => sum + item, 0) / group.length) })).sort((a, b) => a.value.localeCompare(b.value));
      if (summaries.length > 1) { const range = Math.max(...summaries.map((group) => group.predictorMean)) - Math.min(...summaries.map((group) => group.predictorMean)); result.push({ predictor, target: target.column, method: "NUMERIC_BY_TARGET_GROUP", n: summaries.reduce((sum, group) => sum + group.count, 0), absoluteStrength: round(sd ? range / sd : 0), groups: summaries, causality: "NOT_ESTABLISHED" }); }
    }
    for (const predictor of profile.categoricalColumns.filter((column) => column !== target.column && column !== id)) {
      const cells = new Map<string, { predictorValue: string; targetValue: string; count: number }>();
      for (const row of dataset.rows) if (present(row[predictor]) && present(row[target.column])) { const predictorValue = String(row[predictor]), targetValue = String(row[target.column]), key = `${predictorValue}\u0000${targetValue}`; const cell = cells.get(key); cells.set(key, { predictorValue, targetValue, count: (cell?.count ?? 0) + 1 }); }
      result.push({ predictor, target: target.column, method: "CONTINGENCY", n: [...cells.values()].reduce((sum, cell) => sum + cell.count, 0), absoluteStrength: null, cells: [...cells.values()].sort((a, b) => a.predictorValue.localeCompare(b.predictorValue) || a.targetValue.localeCompare(b.targetValue)), causality: "NOT_ESTABLISHED" });
    }
  }
  const order = (method: CrossSectionalAssociation["method"]) => method === "PEARSON" ? 0 : method === "NUMERIC_BY_TARGET_GROUP" ? 1 : method === "GROUP_MEAN_RANGE" ? 2 : 3;
  return result.sort((a, b) => order(a.method) - order(b.method) || (b.absoluteStrength ?? -1) - (a.absoluteStrength ?? -1) || a.predictor.localeCompare(b.predictor));
}

function percentile75(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * 0.75) - 1]; }
export function identifyHighRiskEntities(dataset: UploadedDataset, target: TargetResolution): CrossSectionalAnalysis["highRisk"] {
  if (!target.column) return { rule: "Нет подтверждённого итогового показателя; ранжирование риска по записям не выполнялось.", threshold: null, entities: [] };
  const id = entityColumn(dataset);
  if (target.kind === "NUMERIC") {
    const values = numericSeries(dataset.rows, target.column); if (!values.length) return { rule: "Итоговый показатель не содержит числовых наблюдений.", threshold: null, entities: [] };
    const threshold = percentile75(values); const entities: HighRiskEntity[] = [];
    const dtiColumn = findColumnByRole(dataset.columns, "DTI"), currentColumn = findColumnByRole(dataset.columns, "CURRENT_DELINQUENCY"), historyColumn = findColumnByRole(dataset.columns, "DELINQUENCIES_12M"), ratingColumn = findColumnByRole(dataset.columns, "CREDIT_RATING");
    const dtiValues = dtiColumn ? numericSeries(dataset.rows, dtiColumn) : []; const dtiThreshold = dtiValues.some((value) => value > 1) ? 40 : 0.4;
    dataset.rows.forEach((row, index) => {
      if (!isNumericCell(row[target.column!]) || Number(row[target.column!]) < threshold) return;
      const reasons = [`заданный показатель ${target.column}=${Number(row[target.column!])} на уровне или выше детерминированного порога 75-го перцентиля (${threshold})`];
      if (dtiColumn && isNumericCell(row[dtiColumn]) && Number(row[dtiColumn]) >= dtiThreshold) reasons.push(`${dtiColumn}=${Number(row[dtiColumn])} на уровне или выше явного порога внимания (${dtiThreshold})`);
      if (currentColumn && isNumericCell(row[currentColumn]) && Number(row[currentColumn]) > 0) reasons.push(`${currentColumn}=${Number(row[currentColumn])}`);
      if (historyColumn && isNumericCell(row[historyColumn]) && Number(row[historyColumn]) > 0) reasons.push(`${historyColumn}=${Number(row[historyColumn])}`);
      if (ratingColumn && isNumericCell(row[ratingColumn]) && Number(row[ratingColumn]) < 600) reasons.push(`${ratingColumn}=${Number(row[ratingColumn])} ниже явного порога внимания (600)`);
      entities.push({ entityId: id === "__source_row__" ? `ROW-${index + 1}` : String(row[id]), sourceRow: index + 1, targetValue: Number(row[target.column!]), reasons, evidenceRefs: ["E-005"] });
    });
    entities.sort((a, b) => Number(b.targetValue) - Number(a.targetValue) || a.entityId.localeCompare(b.entityId));
    return { rule: `Ранжирование по заданному показателю ${target.column}; включены значения на уровне или выше 75-го перцентиля по набору данных. Контекстные флаги используют только явные пороги и не влияют на ранжирование.`, threshold, entities };
  }
  const highLabels = new Set(["HIGH", "HIGH_RISK", "CRITICAL", "YES", "TRUE", "1", "ВЫСОКИЙ", "КРИТИЧЕСКИЙ", "ДА"]);
  const entities = dataset.rows.flatMap((row, index) => highLabels.has(String(row[target.column!]).toUpperCase()) ? [{ entityId: id === "__source_row__" ? `ROW-${index + 1}` : String(row[id]), sourceRow: index + 1, targetValue: String(row[target.column!]), reasons: [`${target.column} имеет явную метку высокого риска: ${String(row[target.column!])}`], evidenceRefs: ["E-005"] }] : []);
  return { rule: `Включены записи, у которых заданный показатель ${target.column} имеет явную метку высокого риска.`, threshold: "HIGH", entities };
}

export function analyzeCrossSectional(dataset: UploadedDataset, explicitTarget?: string, metadata?: CrossSectionalFixtureMetadata): CrossSectionalAnalysis {
  const target = resolveTarget(dataset, explicitTarget); const numericSummaries = summarizeNumericColumns(dataset); const categoricalSummaries = summarizeCategoricalColumns(dataset); const associations = calculateAssociations(dataset, target); const highRisk = identifyHighRiskEntities(dataset, target);
  const delinquencyColumns = [findColumnByRole(dataset.columns, "CURRENT_DELINQUENCY"), findColumnByRole(dataset.columns, "DELINQUENCIES_12M")].filter((column): column is string => Boolean(column));
  const affected = dataset.rows.filter((row) => delinquencyColumns.some((column) => isNumericCell(row[column]) && Number(row[column]) > 0)).length;
  const leakage = metadata?.targetProvenance?.target === target.column;
  return {
    dataset: { name: dataset.name, version: stableHash({ columns: dataset.columns, rows: dataset.rows }), entityColumn: entityColumn(dataset), entityCount: dataset.rows.length }, target,
    numericSummaries, categoricalSummaries, associations, drivers: associations.filter((item) => item.absoluteStrength !== null).slice(0, 5), highRisk,
    delinquencyPrevalence: { column: delinquencyColumns.length ? delinquencyColumns.join("|") : null, affected, total: dataset.rows.length, rate: delinquencyColumns.length ? round(affected / dataset.rows.length) : null },
    limitations: ["Связи в поперечном срезе не устанавливают причинность или временной порядок.", ...(target.authoritative ? [] : ["Подтверждённый итоговый показатель отсутствует; анализ риска с учителем не выполнялся."]), ...(leakage ? [`Заданный показатель ${target.column} рассчитан на основе ${metadata!.targetProvenance!.derivedFrom.join(", ")}; связи с этими входными данными могут быть циркулярными.`] : []), ...(dataset.rows.length < 30 ? ["Малое число записей ограничивает устойчивость результатов и интерпретацию подгрупп."] : [])],
  };
}
