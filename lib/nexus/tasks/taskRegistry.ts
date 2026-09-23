import { resolveToolPack as resolveEngineToolPack } from "../agentic/resolveToolPack.ts";
import type { NexusToolDefinition } from "@/lib/nexus/agentic/toolPack";
import { findScenario } from "../demo/scenarios.ts";
import type { DemoScenario } from "@/lib/nexus/demo/scenarios";
import type { DomainId } from "../domains/types.ts";
import { getDomainPack } from "../domains/registry.ts";

/**
 * Registry-backed integration layer over the existing tool packs, scenarios and domain identities.
 * The API delegates TIME_SERIES runtime capability selection here, so a new hackathon domain has one
 * declarative task entry instead of another domain-specific branch in the request path.
 *
 * NEXUS ships exactly one tool-pack resolution key today: "generic" (see `resolveToolPack.ts`). A
 * domain-specific tool pack is added the same way, per `docs/task-adaptation-quickref.md`.
 */

/**
 * The kind of task NEXUS is running. Only "INVESTIGATE" is implemented (Observer → Investigator →
 * Skeptic → hypothesis/challenge). The other three are declared so a task's mode can be recorded and
 * inspected before a matching agent flow exists — adding real OPTIMIZE/MATCH/ANALYZE behavior is
 * explicitly out of scope for this pass (see docs/task-adaptation-quickref.md).
 */
export type TaskMode = "INVESTIGATE" | "OPTIMIZE" | "MATCH" | "ANALYZE";

export interface NexusTaskConfig {
  /** Matches `DemoScenario.id` where a prepared case exists; "generic" has no prepared case. */
  id: string;
  label: string;
  mode: TaskMode;
  /** Optional domain identity used when an ordinary upload has no dedicated task id. */
  domainId?: DomainId;
  /** Which of `resolveToolPack()`'s existing keys this task's tool calls should dispatch through. */
  toolPackScenario: "generic";
  /**
   * Link to the existing prepared-case metadata (title/objective/summary/dataset) in `scenarios.ts`.
   * Undefined for "generic", which has no prepared demo — it's the bare fallback for an arbitrary upload.
   */
  scenario?: DemoScenario;
  /**
   * Field labels this task's dataset introduces, for discoverability only. `displayLabel()`
   * (lib/nexus/report/displayLabels.ts) reads one global merged dictionary today, not a per-task one,
   * because canonical field IDs happen not to collide across the two registered domains. This is
   * intentionally left empty for existing tasks rather than duplicating that dictionary's contents here —
   * see docs/task-adaptation-quickref.md for where a new domain's labels actually need to be added.
   */
  displayLabels?: Record<string, string>;
  /** Pre-filled Command Center objective text. Falls back to `scenario.objective` via `taskObjectivePlaceholder()`. */
  objectivePlaceholder?: string;
  /**
   * Result-screen section vocabulary. Declared metadata only — no component reads this yet
   * (`InvestigationWorkspace.tsx` still renders its own fixed English headings). Wiring it in is a UI
   * change and is explicitly out of scope for this pass.
   */
  resultVocabulary?: {
    chainLabel?: string;
    findingLabel?: string;
    hypothesisLabel?: string;
    skepticLabel?: string;
    finalLabel?: string;
  };
}

export const TASK_REGISTRY: NexusTaskConfig[] = [
  {
    id: "generic",
    label: "Generic descriptive investigation",
    mode: "INVESTIGATE",
    toolPackScenario: "generic",
  },
  {
    id: "synthetic",
    label: "Industrial telemetry (unlisted regression case)",
    mode: "INVESTIGATE",
    toolPackScenario: "generic",
    scenario: findScenario("synthetic"),
  },
];

/** All registered tasks, for anything that needs to enumerate rather than look up by id (e.g. tests). */
export function listTaskConfigs(): NexusTaskConfig[] {
  return TASK_REGISTRY;
}

/** Safe lookup — returns `undefined` for an unknown id, never throws. */
export function resolveTaskConfig(id: string | null | undefined): NexusTaskConfig | undefined {
  return TASK_REGISTRY.find((task) => task.id === id);
}

/**
 * Resolves a tool pack by task id, composing the existing `resolveToolPack()` from
 * `lib/nexus/agentic/resolveToolPack.ts` — it does not reimplement or duplicate tool-pack resolution.
 * An unknown id falls back to the generic pack, matching `runAgenticInvestigation`'s own default
 * ("generic") — this never throws.
 */
export function resolveToolPackForTask(id: string | null | undefined): NexusToolDefinition[] {
  const task = resolveTaskConfig(id);
  return resolveEngineToolPack(task?.toolPackScenario ?? "generic");
}

/**
 * Resolve the existing runtime tool-pack key without duplicating domain logic in the API.
 * A named non-generic task is an explicit execution choice. For an ordinary upload, a
 * registered domain may select its associated task capability. Registered domains without
 * a dedicated tool pack and unknown/ambiguous domains remain on the generic pack.
 */
export function resolveRuntimeToolPackScenario(
  taskId: string | null | undefined,
  domainId: string | null | undefined,
): NexusTaskConfig["toolPackScenario"] {
  const explicitTask = taskId && taskId !== "generic" ? resolveTaskConfig(taskId) : undefined;
  if (explicitTask) return explicitTask.toolPackScenario;
  if (taskId && taskId !== "generic") return "generic";
  const domain = domainId ? getDomainPack(domainId) : undefined;
  const domainTasks = domain ? TASK_REGISTRY.filter(task => task.domainId === domain.id) : [];
  return domainTasks.length === 1 ? domainTasks[0].toolPackScenario : resolveTaskConfig(taskId)?.toolPackScenario ?? "generic";
}

/** The objective text to pre-fill for this task: its own override, else its linked scenario's, else empty. */
export function taskObjectivePlaceholder(task: NexusTaskConfig | undefined): string {
  return task?.objectivePlaceholder ?? task?.scenario?.objective ?? "";
}

/** All currently registered tasks run in INVESTIGATE mode — true today, checked explicitly by tests. */
export const CURRENT_TASK_MODE: TaskMode = "INVESTIGATE";
