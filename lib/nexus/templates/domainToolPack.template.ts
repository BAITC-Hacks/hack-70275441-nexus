/**
 * TEMPLATE — not imported anywhere, not wired into any runtime pack. This file exists only so a new
 * new domain's tool pack has a working starting shape to copy instead of reverse-engineering one
 * from `lib/nexus/construction/tools.ts`. It compiles (it's checked by `tsc --noEmit` like every other
 * .ts file), but nothing in the app imports it.
 *
 * See docs/task-adaptation-quickref.md for how to actually wire a finished copy of this into the app —
 * in short: copy this file's content into a new real file (e.g. `lib/nexus/<domain>/tools.ts`), replace
 * the example tool with real ones, then add one branch to `resolveToolPack()`
 * (lib/nexus/agentic/resolveToolPack.ts) and one entry to `TASK_REGISTRY`
 * (lib/nexus/tasks/taskRegistry.ts). Nothing else in the agent runtime needs to change.
 *
 * Rules a real tool must follow (enforced by convention, not by the type system):
 * - `execute()` must be pure and deterministic — same input, same output, every time. The LLM agents
 *   choose WHEN to call a tool; they never compute the numbers themselves.
 * - Never throw on bad/missing data — return a summary that says so instead (e.g. "no data available").
 * - `variables` should list the canonical dataset column IDs the result is about, in the SAME strings
 *   used in `dataset.columns` — that's what lets `displayLabel()` (lib/nexus/report/displayLabels.ts)
 *   show a human-readable label for them later, without this tool needing to know about labels at all.
 * - Keep `summary` a plain sentence a person can read directly in Evidence cards and Technical Trace.
 */
import type { NexusToolDefinition } from "@/lib/nexus/agentic/toolPack";
import type { ToolContext, ToolResult } from "@/lib/nexus/agentic/types";

/** Replace with your domain's real field names, matching the columns your dataset adapter produces. */
type ExampleDomainRow = {
  example_metric: number;
  example_reference_value: number;
};

const exampleRows = (context: ToolContext) => context.dataset.rows as unknown as ExampleDomainRow[];

/**
 * Example tool: compares one column against a reference value and reports the gap. Copy this shape —
 * argumentKind "none" means the tool always looks at the same fixed columns rather than taking a
 * caller-chosen column/pair (see `toolPack.ts: ToolArgumentKind` for the "column"/"pair" alternatives,
 * used by the generic tool pack in `lib/nexus/agentic/toolRegistry.ts`).
 */
function calculateExampleGap(context: ToolContext): ToolResult {
  const rows = exampleRows(context);
  const last = rows.at(-1);
  if (!last) {
    return { summary: "No observations available to compute the example gap.", variables: [], data: {} };
  }
  const gap = last.example_metric - last.example_reference_value;
  return {
    summary: `Example metric differs from its reference by ${gap.toFixed(2)}.`,
    variables: ["example_metric", "example_reference_value"],
    data: { gap },
  };
}

/**
 * A domain tool pack is just an array of `NexusToolDefinition` — the exact shape
 * `resolveToolPack()` already knows how to return unchanged for a new branch.
 */
export const exampleDomainTools: NexusToolDefinition[] = [
  {
    name: "calculate_example_gap",
    description: "Compares the example metric against its reference value.",
    argumentKind: "none",
    allowedAgents: ["INVESTIGATOR", "SKEPTIC"],
    execute: calculateExampleGap,
  },
];
