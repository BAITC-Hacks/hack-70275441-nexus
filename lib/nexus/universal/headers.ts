export type SemanticColumnRole = "EVENT_ID" | "EVENT_TIMESTAMP" | "EVENT_TYPE" | "EVENT_VALUE" | "ENTITY_ID" | "TARGET_NUMERIC" | "TARGET_CATEGORY" | "CURRENT_DELINQUENCY" | "DELINQUENCIES_12M" | "CREDIT_RATING" | "DTI" | "OTHER";
export type NormalizedHeader = { originalName: string; normalizedName: string; semanticRole: SemanticColumnRole };

const aliases: Record<Exclude<SemanticColumnRole, "OTHER">, string[]> = {
  EVENT_ID: ["ID обращения", "request_id", "event_id", "event id", "transaction_id", "transaction id", "operation_id", "operation id", "id события", "id транзакции", "id операции"],
  EVENT_TIMESTAMP: ["Дата и время обращения", "submitted_at", "timestamp", "event_time", "event time", "transaction_time", "transaction time", "created_at", "date_time", "datetime", "дата", "время", "дата события", "время события", "дата транзакции", "время транзакции"],
  EVENT_TYPE: ["Тип обращения", "event_type", "event type", "action", "operation", "transaction_type", "transaction type", "status", "category", "тип события", "действие", "операция", "тип операции", "тип транзакции", "статус", "категория"],
  EVENT_VALUE: ["amount", "value", "transaction_amount", "transaction amount", "сумма", "значение"],
  ENTITY_ID: ["entity_id", "entity id", "account_id", "account id", "customer_id", "customer id", "user_id", "user id", "device_id", "device id", "order_id", "order id", "source_id", "source id", "client_id", "client id", "id клиента", "идентификатор клиента", "id пользователя", "id устройства", "id заказа", "счет", "счёт"],
  TARGET_NUMERIC: ["risk_score", "risk score", "риск-балл", "риск балл", "балл риска", "default_flag", "default flag", "churn_flag", "churn flag"],
  TARGET_CATEGORY: ["risk_category", "risk category", "категория риска"],
  CURRENT_DELINQUENCY: ["current_delinquency", "просрочка текущая", "текущая просрочка"],
  DELINQUENCIES_12M: ["delinquencies_12m", "просрочек за 12 мес", "просрочки за 12 месяцев"],
  CREDIT_RATING: ["credit_rating", "credit rating", "кредитный рейтинг"],
  DTI: ["dti", "dti %", "dti, %"],
};

/** Normalizes for deterministic matching only; callers keep `originalName` for storage and display. */
export function normalizeHeaderName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[‐‑‒–—−_\-]+/g, " ").replace(/[(),.%]+/g, " ").replace(/\s+/g, " ").trim();
}

const normalizedAliases = Object.fromEntries(Object.entries(aliases).map(([role, names]) => [role, names.map(normalizeHeaderName)])) as Record<Exclude<SemanticColumnRole, "OTHER">, string[]>;
const exactOnlyAliases = new Set(["category", "категория", "request id", "submitted at", "id обращения", "дата и время обращения", "тип обращения"]);
const matchesAlias = (normalizedName: string, alias: string) => normalizedName === alias || !exactOnlyAliases.has(alias) && normalizedName.startsWith(`${alias} `);

export function normalizeHeader(originalName: string): NormalizedHeader {
  const normalizedName = normalizeHeaderName(originalName);
  if (normalizedName === "дата ответа/закрытия") return { originalName, normalizedName, semanticRole: "OTHER" };
  for (const [role, names] of Object.entries(normalizedAliases) as Array<[Exclude<SemanticColumnRole, "OTHER">, string[]]>) {
    if (names.some((alias) => matchesAlias(normalizedName, alias))) return { originalName, normalizedName, semanticRole: role };
  }
  return { originalName, normalizedName, semanticRole: "OTHER" };
}

/** Request/service context only; individual service_type headers remain ordinary dimensions. */
export function normalizeHeaders(columns: string[]): NormalizedHeader[] {
  const headers = columns.map(normalizeHeader);
  const requestContext = headers.some((header) => header.normalizedName === "request id") && headers.some((header) => header.normalizedName === "submitted at");
  return headers.map((header) => requestContext && header.normalizedName === "service type" ? { ...header, semanticRole: "EVENT_TYPE" } : header);
}

export function findColumnByRole(columns: string[], role: Exclude<SemanticColumnRole, "OTHER">): string | undefined {
  const headers = normalizeHeaders(columns);
  const appealType = role === "EVENT_TYPE" ? headers.find(header => header.normalizedName === "тип обращения") : undefined;
  const serviceType = role === "EVENT_TYPE" ? headers.find((header) => header.normalizedName === "service type" && header.semanticRole === role) : undefined;
  return (appealType ?? serviceType ?? headers.find((header) => header.semanticRole === role))?.originalName;
}
