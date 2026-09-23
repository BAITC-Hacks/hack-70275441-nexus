import type { AgentAction } from "./types";

/** Investigator selects narrow deterministic checks before forming a candidate explanation. */
export function chooseInvestigatorActions(focus?: string, comparison?: string, revision = false): AgentAction[] {
  if (!focus) return [{ action: "COMPLETE", reason: "No descriptive signal warrants a candidate explanation." }];
  if (revision) return [{ action: "CALL_TOOL", tool: "inspect_missingness", arguments: { column: focus }, reason: "Testing whether data completeness limits the challenged observation." }, { action: "REVISE_HYPOTHESIS", reason: "Weakening the candidate explanation if the challenge remains unresolved." }];
  return [{ action: "CALL_TOOL", tool: "inspect_series", arguments: { column: focus }, reason: "Inspecting the selected signal's deterministic baseline." }, ...(comparison ? [{ action: "CALL_TOOL" as const, tool: "calculate_correlation", arguments: { left: focus, right: comparison }, reason: "Checking a descriptive association with the most relevant companion signal." }] : []), { action: "FORM_HYPOTHESIS", reason: "Forming a candidate explanation with explicit non-causal limitations." }];
}
