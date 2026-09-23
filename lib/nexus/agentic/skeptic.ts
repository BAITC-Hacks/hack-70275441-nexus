import type { AgentAction } from "./types";

/** Skeptic asks a falsification-oriented deterministic question before issuing a bounded review. */
export function chooseSkepticActions(focus?: string): AgentAction[] {
  return focus ? [{ action: "CALL_TOOL", tool: "detect_outliers", arguments: { column: focus }, reason: "Testing whether the candidate may be dependent on descriptive outliers." }, { action: "CHALLENGE", reason: "Assessing alternative explanations without claiming causal proof." }] : [{ action: "COMPLETE", reason: "No candidate explanation is available to challenge." }];
}
