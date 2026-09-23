import type { SchemaResolution } from "../../../lib/nexus/domains/schemaResolution";
import { getDomainPack, getMetricDefinition } from "../../../lib/nexus/domains/registry";
import { displayLabel } from "../../../lib/nexus/report/displayLabels";
export function SchemaResolutionPanel({ schema, onApply, canApply }: { schema: SchemaResolution; onApply: () => void; canApply: boolean }) {
  const pack = schema.domain.selectedDomainId ? getDomainPack(schema.domain.selectedDomainId) : undefined;
  const matched = schema.columns.filter(c => c.status === "MATCHED").length;
  const candidate = schema.domain.candidates.find(c => c.domainId === pack?.id);
  return <section className="panel schema-resolution"><h3>{pack ? `${schema.domain.source === "MANUAL_OVERRIDE" ? "Выбранный" : "Предполагаемый"} домен: ${pack.labelRu}` : schema.domain.status === "AMBIGUOUS" ? "Не удалось однозначно определить отрасль" : "Недостаточно отраслевых полей для определения домена"}</h3>
    <p>Распознано: {matched} колонок. Не распознано или неоднозначно: {schema.columns.length - matched}.</p>
    {schema.warnings.map(w => <p key={w} role="status">{w}</p>)}
    {!pack && <p>Кандидаты: {schema.domain.candidates.map(c => getDomainPack(c.domainId)?.labelRu ?? c.domainId).join("; ") || "нет"}.</p>}
    <details><summary>Почему выбран этот домен? Сопоставление и происхождение</summary>
      <p>Распознаны зарегистрированные поля: {candidate?.matchedCanonicalMetrics.map(m => getMetricDefinition(pack!.id, m)?.labelRu ?? displayLabel(m)).join("; ") || "нет достаточного соответствия"}. Это соответствие схеме, а не business Evidence расследования.</p>
      <div className="schema-mapping-table"><table><thead><tr><th>Исходная колонка</th><th>Каноническое имя</th><th>Название и статус</th></tr></thead><tbody>{schema.columns.map((c, i) => <tr key={i}><td>{c.originalColumn}</td><td>{c.canonicalMetric ?? "—"}</td><td>{c.status === "MATCHED" ? getMetricDefinition(c.domainId!, c.canonicalMetric!)?.labelRu ?? displayLabel(c.canonicalMetric!) : c.status === "AMBIGUOUS" ? "Неоднозначно" : "Не распознано"}</td></tr>)}</tbody></table></div>
      <pre>{JSON.stringify(schema, null, 2)}</pre>
    </details>
    <button className="secondary" disabled={!canApply || !pack || !matched || schema.columns.some(c => c.status === "AMBIGUOUS")} onClick={onApply}>Применить распознанные имена полей</button>
    <p>Значения, даты, порядок строк и неизвестные колонки сохраняются. Единицы и масштаб необходимо подтвердить по исходным данным.</p>
  </section>;
}
