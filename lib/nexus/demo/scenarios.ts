import { syntheticIndustrialDataset } from "./syntheticIndustrial.ts";
import { eventActivityFixture } from "../universal/fixtures.ts";
import type { UploadedDataset } from "@/lib/nexus/ingestion/types";
import type { DomainId } from "../domains/types.ts";

export type Domain = DomainId | "AUTO / UNKNOWN" | "INDUSTRIAL" | "AGRICULTURE" | "HEALTHCARE" | "OTHER";
export const DOMAINS: Domain[] = ["AUTO / UNKNOWN", "RETAIL", "LOGISTICS", "MANUFACTURING", "MINING", "INDUSTRIAL", "AGRICULTURE", "HEALTHCARE", "OTHER"];

export interface DemoScenario {
  id: string;
  title: string;
  sector: string;
  /** Pre-filled investigation objective — the user can rewrite it before starting. */
  objective: string;
  summary: string;
  domain: Domain;
  /** Optional declarative pack identity; it does not alter workflow admission or tool selection. */
  domainId?: Lowercase<DomainId>;
  target: string;
  /** Listed scenarios appear in the Command Center; unlisted ones stay runnable by URL for regression checks. */
  listed: boolean;
  dataset: () => UploadedDataset;
}

/**
 * Prepared investigations. Each one is only a dataset plus a starting objective — every scenario runs through
 * the same Command Center → Investigation → Result path, so a demo is a case inside NEXUS, not its own product.
 */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "event-activity",
    title: "Расследование активности событий",
    sector: "ОБЩЕЕ",
    objective: "Исследовать необычные скопления, повторы и концентрацию активности в журнале событий.",
    summary: "Нейтральные записи событий: активность сущностей, время, типы, значения и статус.",
    domain: "AUTO / UNKNOWN",
    target: "",
    listed: false,
    dataset: () => structuredClone(eventActivityFixture),
  },
  {
    id: "synthetic",
    title: "Дрейф промышленной телеметрии",
    sector: "ПРОМЫШЛЕННОСТЬ",
    objective: "Исследовать нарастающий дрейф в телеметрии промышленных датчиков.",
    summary: "Синтетический дрейф датчиков — общий описательный регресс-кейс.",
    domain: "INDUSTRIAL",
    target: "",
    listed: false,
    dataset: syntheticIndustrialDataset,
  },
];

export const findScenario = (id: string | null | undefined): DemoScenario | undefined =>
  DEMO_SCENARIOS.find((scenario) => scenario.id === id);
