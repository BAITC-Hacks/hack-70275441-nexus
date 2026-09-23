# Task Adaptation Harness

Read this once, in the NEW hackathon repository, the moment the real technical specification is announced.

**Scope note:** this document covers the full decision procedure — including whether NEXUS is even a fit,
which data shape applies, and how to adapt a non-`INVESTIGATE` task. For the narrower case of "an ordinary
`TIME_SERIES`/`INVESTIGATE` task over tabular data," the quick file list in
[`docs/task-adaptation-quickref.md`](task-adaptation-quickref.md) is faster to use directly — this document
is the one to reach for first when the shape of the task is not yet known, or when it looks like
`CROSS_SECTIONAL`/`EVENT_TRANSACTION`/something else entirely. The two documents are not duplicates: this
one is the map, the other is a checklist for one specific, already-traveled route on that map.

**Core principle: reuse the infrastructure, not the current problem.** The engine and the Domain Registry
mechanism are the reusable core — no domain's specific tool pack or demo content is checked in today, so
the next domain is built to fit the actual task rather than adapted from a pre-built example.

---

## STEP 1 — Read the technical specification

Extract, in writing, before touching code:

- **Problem** — what is the organizer actually asking to be solved?
- **User** — who reads the output?
- **Required output** — a report, a ranking, a decision, an alert, a number?
- **Dataset / data source** — format, size, how it is delivered (upload, API, fixed file)?
- **Evaluation requirements** — what will the jury specifically check or demo live?
- **Mandatory technologies/integrations** — anything the brief requires that NEXUS does not have?
- **Constraints** — time limit, no-internet requirement, specific output format, language?

## STEP 2 — Decide whether NEXUS fits

Map the task to one of:

- **investigation** ("why is X happening, what moved first, how sure are we?") — NEXUS's actual strength.
- **monitoring / descriptive analysis** — NEXUS's generic tools (profiling, correlation, outliers, missingness) cover this well even without a hypothesis-and-challenge story.
- **prediction / forecasting** — NEXUS does not forecast. It can still describe what happened in the data, but do not promise a predictive model.
- **optimization / allocation / routing** — NEXUS has no solver. `TaskMode: "OPTIMIZE"` is declared but has zero implemented behavior. This needs genuinely new code, not configuration.
- **matching / ranking two sets of things** — same as above; `TaskMode: "MATCH"` exists only as a label today. A scored-ranking output (weighted factors → a priority score per group) is a small, deterministic calculation to write from scratch if the new task is ranking-shaped — no existing precedent is checked in today.

**If the task is investigation- or monitoring-shaped: proceed with configuration, not new architecture.**
**If it is optimization/matching-shaped and time is short: be honest that this needs a real solver module, budget accordingly, and do not force NEXUS's investigation framing onto a task it does not fit.**

## STEP 3 — Inspect the dataset

Before writing any code, determine:

- **Data shape** — one row per time period (`TIME_SERIES`), one row per entity (`CROSS_SECTIONAL`), one row per event/transaction (`EVENT_TRANSACTION`), or none of these cleanly (`AMBIGUOUS_TABULAR`)? `lib/nexus/universal/profile.ts: profileShape()` already implements this detection — run the actual file through it (or through the app's own upload screen) rather than guessing from column names.
- **Temporal / entity keys** — is there a real calendar date column? A unique-per-row entity ID?
- **Target/outcome candidates** — which numeric column is the thing being investigated?
- **Dimensions** — categorical columns useful for grouping/ranking (department, region, product…)?
- **Missingness** — how much, and is it structural (a field that legitimately doesn't apply) or a data-quality problem?
- **Units** — currency, percentage, count, duration — needed for `DomainMetricDefinition.unit`/`valueType`.
- **Domain terminology** — what do practitioners actually call these columns? This becomes your alias list.

## STEP 4 — Choose or adapt a Domain Pack

Reuse an existing pack (`RETAIL`, `LOGISTICS`, `MANUFACTURING`, `MINING`) **only if the metrics are
genuinely the same concepts** — matching column names coincidentally is not enough; a wrong domain match
with the right *shape* of metrics is worse than an honest "no pack" fallback, because it produces a
confidently wrong story instead of a correctly generic one.

Otherwise create the smallest new pack, following `lib/nexus/domains/retail.ts` (a minimal
vocabulary-only example) as a template:

1. A new `{domain}.ts` + `{domain}Metrics.ts` pair under `lib/nexus/domains/`.
2. `DomainMetricDefinition` entries: `canonicalName`, `labelRu`, `role`, `valueType`, `unit`, `riskDirection`, `aliases`.
3. `detection`: `strongMetrics`/`characteristicMetrics`/`minimumMatch`/`minimumMargin` — tune so this domain wins schema resolution on the real dataset without also winning on an unrelated one.
4. Register the new `DomainId` in `lib/nexus/domains/types.ts` and add the pack to `DOMAIN_PACKS` in `lib/nexus/domains/registry.ts`.
5. Cautious `causalPriors` only if you have a genuine domain-expected lead-lag relationship to declare — an empty array is a legitimate, honest choice when you don't.

## STEP 5 — Resolve runtime capability

Start with the generic deterministic tools (`lib/nexus/agentic/toolRegistry.ts`) — they cover profiling,
correlation, outlier detection, missingness, and directional movement, and are enough for a full
investigation with no specialized tools at all whenever the dataset's own registry metadata (not a
specialized tool pack) is sufficient to identify and label its metrics.

Add a specialized tool pack (`STEP 9`) **only** when the task/dataset needs a calculation the generic tools
cannot express — see `lib/nexus/templates/domainToolPack.template.ts` for a starting shape.

For a `TIME_SERIES`/`INVESTIGATE` task, wire the choice declaratively: add one `NexusTaskConfig` entry to
`TASK_REGISTRY` (`lib/nexus/tasks/taskRegistry.ts`) with `toolPackScenario: "generic"` unless you built a new
pack, and (for an ordinary upload with no explicit task id) set `domainId` so
`resolveRuntimeToolPackScenario` can link a registered domain to its tool pack automatically. **Never** add
a new `if domain === "..."` branch to `app/api/investigate/route.ts` or to `orchestrator.ts` — that
function is the one and only place this decision is made.

## STEP 6 — Map dataset schema

Raw columns → canonical metrics → audit the mapping before trusting it:

- `resolveDatasetSchema(columns)` (`lib/nexus/domains/schemaResolution.ts`, re-exported from
  `lib/nexus/domains/resolution.ts`) returns `status: RESOLVED/AMBIGUOUS/UNKNOWN`, `source:
  SCHEMA_MATCH/MANUAL_OVERRIDE`, and a per-column `MATCHED/UNKNOWN/AMBIGUOUS` mapping.
- Look at `components/nexus/workspace/SchemaResolutionPanel.tsx` for how this is already surfaced to a
  human before an investigation starts — reuse it, do not build a second confirmation UI.
- An `AMBIGUOUS`/`UNKNOWN` status is a correct, safe outcome for an unrecognized dataset — do not "fix" it
  by lowering `minimumMatch`/`minimumMargin` just to force a result.

## STEP 7 — Define the investigation objective

Write one Russian sentence (matching the existing UI language) stating what NEXUS should investigate —
this becomes `NexusTaskConfig.objectivePlaceholder` or the linked `DemoScenario.objective`. Keep it
descriptive ("why is X rising"), never predictive ("will X exceed threshold Y").

## STEP 8 — Run the existing pipeline

```text
Detect → Investigator → deterministic tool → Evidence → Skeptic → Validate
```

This is `runAgenticInvestigation` (TIME_SERIES) or the equivalent bounded workflow
(`lib/nexus/crossSectional/workflow.ts`, `lib/nexus/eventTransaction/workflow.ts`) — do not write a new
orchestration loop. If the data shape is `CROSS_SECTIONAL` or `EVENT_TRANSACTION`, the relevant `liveTools.ts`
in that workflow's folder is where a new domain's deterministic tools would go, following the same
generic-first, specialize-only-if-needed rule as TIME_SERIES.

## STEP 9 — Add domain-specific computation only if required

Copy `lib/nexus/templates/domainToolPack.template.ts`, implement each tool's `execute` against the actual
dataset shape, and register it in `resolveToolPack()` (`lib/nexus/agentic/resolveToolPack.ts`) under a new
`toolPackScenario` key. **No industry logic belongs in the generic agents, the orchestrator, or the
admission layer** — a domain tool pack is the only place domain-specific calculation should live.

## STEP 10 — Define a safe action

`lib/nexus/action/exportDecision.ts` is domain-agnostic and already handles the full
`PROPOSED → POLICY_APPROVED → EXECUTED → VERIFIED` lifecycle plus recompute-and-diff verification. For a
new task, the only thing that usually needs to change is `resolveTargetRows`/`proposeExportDecision`
(`lib/nexus/action/proposeAction.ts`) — what rows get exported and why. Keep the action a controlled
export/recommendation (CSV, JSON, a flagged list, a case file) — never an executed intervention.

## STEP 11 — Verify

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Then a live smoke test on both the new task and an existing one (to prove nothing broke):
`/investigate` loads, the new task's data can be selected/uploaded, the investigation completes (or falls
back safely without `OPENAI_API_KEY`), labels are human-readable, Technical Trace still shows canonical
IDs, and export reaches `VERIFIED`.

## STEP 12 — Rewrite presentation for the selected track

90% of the jury story should be the chosen task, told through `components/nexus/workspace/DecisionView.tsx`
and `lib/nexus/report/investigationViewModel.ts` (presentation-only — see the change boundaries below).
Universality (the Domain Registry, the generic engine) is supporting evidence for development potential,
not the headline demo.

---

## File map

| Component | Path | Modify when | Do NOT modify to |
|---|---|---|---|
| Domain Registry | `lib/nexus/domains/registry.ts`, `types.ts`, `{domain}.ts`, `{domain}Metrics.ts` | adding/adjusting a domain's metrics, aliases, detection tuning | change how `DOMAIN_PACKS`/`getDomainPack` itself resolves — that mechanism is generic |
| Schema resolution | `lib/nexus/domains/schemaResolution.ts` (+ `resolution.ts` re-export) | never, for a normal adaptation — it is generic scoring over any registered pack's metrics | add a domain-name branch here |
| Task Registry / runtime capability | `lib/nexus/tasks/taskRegistry.ts` | adding a `NexusTaskConfig` entry, linking a `domainId` | add an `if taskId === "..."` branch anywhere else — this file is the one place |
| Tool-pack resolution | `lib/nexus/agentic/resolveToolPack.ts` | registering a new specialized tool pack under a new scenario key | add a domain conditional to `app/api/investigate/route.ts` instead |
| Generic tools | `lib/nexus/agentic/toolRegistry.ts`, `toolPack.ts` | almost never — these are deliberately domain-agnostic | add domain-specific logic inside a generic tool |
| Domain tool pack | `lib/nexus/templates/domainToolPack.template.ts` (starter shape, inert) | the dataset needs a calculation the six generic tools cannot express | duplicate a generic tool with a domain-flavored name that computes the same thing |
| Scenario / demo registry | `lib/nexus/demo/scenarios.ts` | adding a prepared Command Center case | — |
| Investigator / Skeptic runtime | `lib/nexus/agentic/liveInvestigator.ts`, `liveSkeptic.ts`, `orchestrator.ts` (TIME_SERIES); `lib/nexus/agentic/boundedRuntime/runtime.ts` (CROSS_SECTIONAL/EVENT_TRANSACTION) | a concrete regression only | model, timeout, retries, reasoning effort, token budget — closed per STEP 27 below unless a regression is proven |
| Agent instructions | `lib/nexus/tasks/agentInstructions.ts` | the task genuinely isn't `INVESTIGATE`-shaped | rewrite for a purely descriptive/config change — leave untouched for an ordinary new `INVESTIGATE` task |
| Evidence contract | `lib/nexus/agentic/types.ts` (`EvidenceRecord`, `AgenticResult`) | essentially never | widen/relax it to accommodate a shortcut |
| Validator | `lib/nexus/timeSeries/validator.ts`, `lib/nexus/crossSectional/validator.ts`, `lib/nexus/eventTransaction/validator.ts` | never, for an ordinary adaptation | weaken the recompute-and-diff check to make a demo pass |
| Decision View / presentation | `components/nexus/workspace/DecisionView.tsx`, `lib/nexus/report/investigationViewModel.ts`, `lib/nexus/report/displayLabels.ts` | STEP 12 — rewriting the jury story, adding domain labels | recompute statistics or fabricate a stronger verdict here — this layer is presentation-only |
| Action layer | `lib/nexus/action/exportDecision.ts`, `proposeAction.ts`, `policy.ts` | changing what rows get exported (`proposeAction.ts`) for the new task | change the `PROPOSED → POLICY_APPROVED → EXECUTED → VERIFIED` lifecycle or the verification logic |

---

## Change boundaries

### Usually safe to adapt

- A Domain Pack's metrics, aliases, detection thresholds.
- A dataset/demo function and its `DemoScenario` entry.
- A `NexusTaskConfig` entry (Task Registry).
- A new, additive deterministic domain tool pack.
- Presentation copy/labels (`displayLabels.ts`, Decision View copy).
- Action configuration (`proposeAction.ts`'s target-row selection).

### Usually do NOT change without the spec explicitly requiring it

- Generic agent architecture (`orchestrator.ts`, `boundedRuntime/runtime.ts`).
- The Evidence contract (`EvidenceRecord`, `AgenticResult`).
- The statistical core (`lib/engine/statistics.ts`, `inferentialStats.ts`, `precursorChain.ts` — Pearson, p-values, Fisher CI, Holm, bootstrap, lag scan/`MAX_LAG`).
- Validator contracts (recompute-and-diff logic).
- Generic admission architecture (`lib/nexus/universal/`).
- Core action integrity (the four-stage lifecycle, `verifyExecution`'s checks).
- Runtime trace semantics (`AgentRuntimeTrace.tsx`, `llmRequest.ts`'s audit shape).

---

## Prompt template for the primary coding agent

```text
You are adapting NEXUS to this hackathon's technical specification:

<TASK_SPEC>

Selected track: <SELECTED_TRACK>
Dataset: <DATASET_DESCRIPTION>
Required output: <REQUIRED_OUTPUT>
Constraints: <CONSTRAINTS>

Before writing any code:
1. Inspect the existing NEXUS architecture (docs/task-adaptation-harness.md is the map;
   docs/task-adaptation-quickref.md if this is an ordinary TIME_SERIES/INVESTIGATE task).
2. Produce a gap analysis: what does NEXUS already do that this task needs, and what is missing?
3. Identify reusable components (be specific: file paths, not "the backend").
4. Identify the minimum required adaptations — classify each as KEEP / CONFIGURE / ADAPT / ADD.
5. State explicitly which invariants you will preserve: Reasoning vs Computation, Evidence authority,
   causality NOT_ESTABLISHED, no domain branches in generic agents/admission/API route.
6. Implement ONE bounded stage at a time — do not touch multiple layers (Domain Registry, tool pack,
   presentation) in the same pass unless the spec genuinely requires it in one step.
7. Run: npm test, npm run typecheck, npm run lint, npm run build.
8. Leave changes uncommitted for review. Do not stage, commit, or push.

Return the gap analysis and the KEEP/CONFIGURE/ADAPT/ADD plan before implementing anything.
```

---

## Review checklist (Claude Code, Codex, or any competent reviewing agent)

- **Task fit** — does the chosen track genuinely match what was implemented, or was NEXUS forced onto a task it doesn't fit (e.g. optimization dressed up as investigation)?
- **Domain correctness** — do the Domain Pack's metrics genuinely match this dataset's real-world meaning, not just coincidentally-similar column names?
- **Schema mapping** — does `resolveDatasetSchema` actually resolve automatically (`SCHEMA_MATCH`), or is there a hidden `MANUAL_OVERRIDE` propping up a demo?
- **Deterministic authority** — does every displayed number trace back to a deterministic tool/validator, never to parsed LLM prose?
- **Evidence integrity** — is Evidence ever mutated, fabricated for a missing ID, or silently dropped in a way that changes the story's meaning?
- **Causality language** — does any new copy imply proven causality, a solved problem, or an executed intervention?
- **Action integrity** — does the export still gate on `VALIDATED`, and does it still say "controlled export," not "action taken"?
- **Regression** — does the full test suite (`npm test`) still pass, including the generic-engine and Domain Registry tests unrelated to the new domain?
- **Demo readability** — can a jury member follow Detect → Investigate → Evidence → Challenge → Validate → Act on one screen without reading source code?
- **Rubric alignment** — does this change move a specific hackathon rubric criterion, or is it unrequested polish? (See `README.md §33`-equivalent rubric mapping in the hardening report for this stage.)
