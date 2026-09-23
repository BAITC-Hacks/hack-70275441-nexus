import type { UploadedDataset } from "../ingestion/types.ts";
import type { CrossSectionalFixtureMetadata } from "../crossSectional/types.ts";

const dti = [0.18, 0.22, 0.27, 0.31, 0.35, 0.38, 0.42, 0.46, 0.49, 0.53, 0.58, 0.64];
const delinquency = [0, 0, 0, 1, 0, 1, 1, 1, 2, 2, 3, 3];
const current = [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1];
const rating = [742, 718, 701, 680, 667, 651, 624, 612, 588, 565, 541, 510];
const ages = [31, 45, 28, 52, 36, 41, 29, 57, 34, 48, 39, 55];
const incomes = [2400, 1900, 3100, 2200, 2700, 1800, 3500, 2050, 2900, 2300, 2600, 1700];
const loanAmounts = [12000, 6500, 18000, 9000, 14000, 7200, 21000, 11000, 15500, 8000, 13200, 9500];
const payments = [420, 310, 520, 380, 460, 340, 610, 430, 560, 390, 590, 510];
const experience = [6, 15, 4, 21, 9, 11, 5, 25, 8, 18, 10, 23];

/** Synthetic cross-sectional acceptance fixture. `risk_score` is supplied, not predicted by NEXUS. */
export const bankClients: UploadedDataset = {
  name: "bank-clients.csv",
  columns: ["client_id", "region", "age", "employment_type", "work_experience", "monthly_income", "loan_type", "loan_amount", "loan_term", "monthly_payment", "credit_history", "open_credits", "current_delinquency", "delinquencies_12m", "credit_rating", "DTI", "risk_score", "risk_category"],
  rows: Array.from({ length: 12 }, (_, i) => {
    const score = Math.round((10 + dti[i] * 30 + delinquency[i] * 7 + current[i] * 10 + (700 - rating[i]) * 0.1) * 10) / 10;
    return {
      client_id: `C-${String(i + 1).padStart(3, "0")}`, region: i % 3 === 0 ? "South" : i % 3 === 1 ? "North" : "Central",
      age: ages[i], employment_type: i % 4 === 0 ? "self-employed" : "salaried", work_experience: experience[i],
      monthly_income: incomes[i], loan_type: i % 2 ? "consumer" : "mortgage", loan_amount: loanAmounts[i],
      loan_term: i % 2 ? 24 : 36, monthly_payment: payments[i], credit_history: rating[i] >= 680 ? "strong" : rating[i] >= 600 ? "established" : "weak",
      open_credits: 1 + i % 4, current_delinquency: current[i], delinquencies_12m: delinquency[i], credit_rating: rating[i], DTI: dti[i],
      risk_score: score, risk_category: score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW",
    };
  }),
};

export const bankFixtureMetadata: CrossSectionalFixtureMetadata = {
  datasetName: bankClients.name,
  targetProvenance: {
    target: "risk_score", kind: "SUPPLIED_DERIVED_SCORE",
    derivedFrom: ["DTI", "delinquencies_12m", "current_delinquency", "credit_rating"],
    formula: "round1(10 + DTI*30 + delinquencies_12m*7 + current_delinquency*10 + (700-credit_rating)*0.1)",
  },
};

/** Regression fixture matching the headers observed in the real 60-row browser upload. */
export const russianBankClients60: UploadedDataset = {
  name: "bank_risk_data.xlsx",
  columns: ["ID клиента", "Возраст", "Стаж работы (лет)", "Ежемесячный доход (тг)", "Сумма кредита (тг)", "Срок кредита (мес)", "Ежемесячный платёж (тг)", "Кредитная история (лет)", "Кол-во открытых кредитов", "DTI, %", "Кредитный рейтинг (300–850)", "Просрочек за 12 мес (шт)", "Просрочка текущая (дней)", "Риск-балл", "Категория риска", "Регион", "Тип занятости", "Тип кредита", "ФИО"],
  rows: Array.from({ length: 60 }, (_, index) => {
    const risk = 18 + index % 55; const category = risk >= 60 ? "Высокий" : risk >= 40 ? "Средний" : "Низкий";
    return {
      "ID клиента": `KZ-${String(index + 1).padStart(3, "0")}`, "Возраст": 23 + index % 38, "Стаж работы (лет)": 1 + index % 24,
      "Ежемесячный доход (тг)": 220000 + index * 7500, "Сумма кредита (тг)": 900000 + index * 42000, "Срок кредита (мес)": [12, 24, 36, 48][index % 4],
      "Ежемесячный платёж (тг)": 55000 + index * 1300, "Кредитная история (лет)": 1 + index % 18, "Кол-во открытых кредитов": 1 + index % 5,
      "DTI, %": 18 + index % 47, "Кредитный рейтинг (300–850)": 760 - index * 5, "Просрочек за 12 мес (шт)": index % 4,
      "Просрочка текущая (дней)": index % 9 === 0 ? 12 : 0, "Риск-балл": risk, "Категория риска": category,
      "Регион": ["Алматы", "Астана", "Шымкент"][index % 3], "Тип занятости": index % 5 === 0 ? "Самозанятый" : "Наёмный сотрудник",
      "Тип кредита": index % 2 ? "Потребительский" : "Ипотечный", "ФИО": `Клиент ${index + 1}`,
    };
  }),
};

/** Domain-neutral event fixture with baseline activity, one burst, one rare type and one repeated signature. */
export const eventActivityFixture: UploadedDataset = {
  name: "event_activity_fixture.csv",
  columns: ["event_id", "timestamp", "entity_id", "event_type", "amount", "status"],
  rows: Array.from({ length: 30 }, (_, index) => {
    const burst = index < 8;
    const timeMs = Date.UTC(2026, 7, 1, 9, 0) + (burst ? index * 60_000 : (index - 7) * 30 * 60_000);
    return {
      event_id: `EV-${String(index + 1).padStart(3, "0")}`,
      timestamp: new Date(timeMs).toISOString().replace(".000Z", "Z"),
      entity_id: burst ? "ENTITY-HIGH-ACTIVITY" : `ENTITY-${String(1 + index % 7).padStart(2, "0")}`,
      event_type: index === 7 ? "manual_review" : burst && index < 3 ? "payment" : ["view", "update", "payment"][index % 3],
      amount: index === 7 ? 10_000 : burst && index < 3 ? 100 : 40 + index * 3,
      status: index % 5 === 0 ? "queued" : "completed",
    };
  }),
};
