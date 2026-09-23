import type { GenericAnalysis } from "@/lib/nexus/adapters/generic/analyze";
import type { AgentAction } from "./types";

/** Observer selects at most three descriptive candidates; it never supplies an explanation. */
export function observeCandidates(analysis: GenericAnalysis): { columns: string[]; actions: AgentAction[] } {
  const columns = analysis.findings.slice(0, 3).map((finding) => finding.column);
  return { columns, actions: columns.map((column) => ({ action: "CALL_TOOL", tool: "inspect_directional_movement", arguments: { column }, reason: "Checking whether the descriptive deviation persists through the recent observations." })) };
}
