import type { CanonicalConcept } from "./types.ts";
import type { CellValue, ColumnProfile } from "../ingestion/types.ts";
import { periodTime } from "../universal/profile.ts";

export type StructuralVerdict = "STRUCTURALLY_CONFIRMED" | "AMBIGUOUS" | "REJECTED";
export type StructuralCheck = { id: string; passed: boolean; detail: string };
export type StructuralValidation = { column: string; canonicalId: string; verdict: StructuralVerdict; checks: StructuralCheck[] };
const token = (value: CellValue) => String(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
const isNumeric = (value: CellValue) => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
const integerLike = (value: number) => Math.abs(value - Math.round(value)) <= 1e-9;

/** Compatibility checks only: no header inference, new profile, coercion of output, or decision authority. */
export function validateProposedMapping(concept: CanonicalConcept, profile: ColumnProfile, values: readonly CellValue[], rowCount: number): StructuralValidation {
  const checks: StructuralCheck[] = [];
  let ambiguous = false, rejected = false;
  function check(id: string, passed: boolean, detail: string, hard = false) {
    checks.push({ id, passed, detail });
    if (!passed) { if (hard) rejected = true; else ambiguous = true; }
  }
  const present = values.filter(value => value !== null && !(typeof value === "string" && value.trim() === ""));
  const numbers = present.filter(isNumeric).map(Number);
  const unique = new Set(present.map(token)).size;
  check("input_completeness", Number.isInteger(rowCount) && rowCount > 0 && values.length === rowCount, "Checks require the complete column and a positive row count.");
  check("profile_consistency", profile.missing === values.length - present.length && profile.unique === new Set(present.map(String)).size, "Existing profile counts must agree with supplied values.");
  // At most 5% missing and at least three observations are required for confirmation.
  check("support", present.length >= 3 && rowCount > 0 && (rowCount - present.length) / rowCount <= 0.05, "Confirmation requires three observations and no more than 5% missing values.");
  if (present.length) switch (concept.dataType) {
    case "NUMERIC": {
      check("numeric_compatibility", numbers.length / present.length >= 0.95, "At least 95% of present values must be finite numeric values.", numbers.length === 0);
      if (numbers.length !== present.length) check("numeric_borderline", false, "Unparsed values prevent confirmation; no values are replaced.");
      if (numbers.length) {
        switch (concept.unitFamily) {
          case "COUNT": check("count_unit", numbers.every(n => n >= 0 && integerLike(n)), "Counts must be nonnegative and integer-like.", true); break;
          case "DAYS": case "HOURS": case "DURATION": check("duration_unit", numbers.every(n => n >= 0), "Durations must be finite and nonnegative.", true); break;
          case "PERCENTAGE": {
            check("percentage_range", numbers.every(n => n >= 0 && n <= 100), "Plausible percentage scales are 0..1 or 0..100.", true);
            check("percentage_scale", !(numbers.some(n => n > 0 && n < 1) && numbers.some(n => n > 1)), "Fractional values below one together with values above one leave scale ambiguous; values are unchanged.");
            break;
          }
          default: check("finite_numeric_unit", numbers.every(Number.isFinite), "No universal upper bound, score polarity, or sign restriction is inferred for this unit.", true);
        }
        if (concept.canonicalId === "delinquency_days") check("delinquency_days_guard", numbers.every(n => integerLike(n) && n >= 0 && n <= 3650), "DPD must be integer-like and within 0..3650 days.", true);
        if (concept.canonicalId === "satisfaction") check("satisfaction_scale", numbers.every(n => n >= 0 && n <= 100), "Compatible scales: 1..5, 1..10, or 0..100; other ranges remain ambiguous. No rescaling.");
      }
      break;
    }
    case "IDENTIFIER": {
      const ratio = unique / present.length;
      check("identifier_uniqueness", ratio >= 0.95, "Identifiers require at least 95% distinct present values.", present.length >= 3 && ratio < 0.5);
      check("identifier_measure_distribution", !(numbers.length === present.length && numbers.filter(n => !integerLike(n)).length / numbers.length >= 0.8), "An overwhelmingly fractional numeric distribution contradicts identifier structure.", true);
      break;
    }
    case "BOOLEAN": {
      const aliases = concept.valueAliases;
      const allowed = aliases ? new Set(Object.entries(aliases).flatMap(([key, entries]) => [key, ...entries]).map(token)) : new Set(["true", "false", "yes", "no", "да", "нет", "1", "0"]);
      check("boolean_vocabulary", present.every(value => allowed.has(token(value))), "Unknown boolean vocabulary remains ambiguous, never false.");
      check("boolean_cardinality", unique <= (aliases ? allowed.size : 8), "Boolean vocabulary must have a bounded distinct set.");
      if (concept.canonicalId === "repeat_request") {
        check("repeat_declared_vocabulary", !!aliases && present.every(value => allowed.has(token(value))), "Repetition requires declared value aliases, never complaint categories.");
        check("repeat_not_overdue", !["overdue", "просрочено", "просрочка"].includes(token(profile.name)), "An overdue column does not establish repetition semantics.");
      }
      break;
    }
    case "DATETIME": {
      const parsed = present.filter(value => periodTime(value) !== null).length;
      check("datetime_parser", parsed === present.length, "Use the existing explicit-calendar parser independently of profile.kind; numeric epochs are not dates.", parsed === 0);
      break;
    }
    case "CATEGORICAL":
      check("categorical_variation", unique > 1, "At least two meaningful categorical values are required.");
      check("categorical_cardinality", present.length >= 5 && unique / present.length <= 0.8, "Tiny samples or nearly unique values cannot establish categorical structure.");
      break;
    case "TEXT": check("text_insufficient", false, "Structure alone does not establish the meaning of free text."); break;
  }
  return { column: profile.name, canonicalId: concept.canonicalId, verdict: rejected ? "REJECTED" : ambiguous ? "AMBIGUOUS" : "STRUCTURALLY_CONFIRMED", checks };
}
