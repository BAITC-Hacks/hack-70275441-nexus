# Task Adaptation Quick Reference

Practical, use-during-the-hackathon guide. Read this once before touching code once the hackathon starts.

**Core principle: reuse the infrastructure, not the current problem.** NEXUS's ingestion, agent runtime,
tool runtime, evidence layer, Result renderer, and PDF export do not know or care that today's demos are
about risk. Only four things are actually domain-specific: the tool pack, the display labels, the dataset,
and (rarely) one or two sentences in the agent instructions.

---

## 1. Read the challenge

Before writing anything, answer these seven questions about the actual hackathon brief:

- **USER** — who is this for?
- **PROBLEM** — what are they stuck on?
- **INPUT** — what data do they hand us? (file format, structure, size)
- **DECISION** — what do they need to decide or understand afterward?
- **OUTPUT** — what does "done" look like on screen / in a file?
- **SUCCESS CRITERIA** — how will judges tell a good answer from a shallow one?
- **TASK MODE** — which of these does the challenge actually look like?
  - `INVESTIGATE` — explain an observed pattern, form and challenge a hypothesis (**this is the only
    mode NEXUS runs today**)
  - `ANALYZE` — descriptive/diagnostic, no causal hypothesis needed
  - `MATCH` — pair/rank/recommend between two sets of things
  - `OPTIMIZE` — allocate/schedule/route under constraints

If it's `INVESTIGATE` or close to it, you are mostly configuring, not building. If it's `MATCH` or
`OPTIMIZE`, budget real implementation time for the decision logic itself — NEXUS gives you the shell
around it, not the solver.

---

## 2. Decide reuse

Classify every relevant piece as:

- **KEEP** — use exactly as-is, zero edits
- **CONFIGURE** — add data to an existing config/registry, no logic changes
- **ADAPT** — edit existing logic/copy in place
- **ADD** — genuinely new code (a new tool pack, a new adapter, a new solver)

The full universal/domain/scenario architecture breakdown was already done as a one-time analysis pass
before the hackathon — don't redo it under time pressure. Trust the file list in §3 below.

---

## 3. Minimum files to touch

For a new **INVESTIGATE/ANALYZE**-style analytical task over tabular data, expect to touch roughly this
many files, in this order:

1. **Task registry** — `lib/nexus/tasks/taskRegistry.ts`
   Add one `NexusTaskConfig` entry to `TASK_REGISTRY`. Set `domainId` when ordinary uploads for that domain
   should reuse this task's runtime capability. Set `toolPackScenario` to `"generic"` unless you're also
   adding a dedicated tool pack (step 3 below). Link `scenario` to a `DemoScenario` if one exists, or leave
   it undefined.

2. **Display labels** — `lib/nexus/report/displayLabels.ts`
   Add your dataset's canonical column IDs → human-readable labels to `CONSTRUCTION_LABELS`/`FINTECH_LABELS`-style
   object literals (or a new one merged into `DISPLAY_LABELS`). Unmapped IDs already fall back to a
   prettified form, so this step is optional for a rough demo, worth doing for the polished one.

3. **Domain tool pack** *(only if the generic tools genuinely aren't enough)* — new file under
   `lib/nexus/<domain>/tools.ts`, copied from `lib/nexus/templates/domainToolPack.template.ts`
   (see §6 below). Then add one branch to `resolveToolPack()` in `lib/nexus/agentic/resolveToolPack.ts`.
   Most analytical tasks over tabular data do **not** need this step — the six generic tools
   (`profile_dataset`, `inspect_series`, `calculate_correlation`, `detect_outliers`, `inspect_missingness`,
   `inspect_directional_movement`) already cover descriptive statistics, correlation, and outliers.

4. **Dataset / adapter** — a small function returning `UploadedDataset` (`{name, columns, rows}`), following
   `lib/nexus/demo/fintechTimeSeries.ts` or `lib/nexus/demo/syntheticIndustrial.ts` as a template. If the
   challenge hands you CSV/XLSX directly, you may not need this at all — the upload path in
   `components/nexus/workspace/InvestigationWorkspace.tsx` already parses both.

5. **Agent task instructions** — *only if the task genuinely isn't explanatory* (i.e. TASK MODE above isn't
   `INVESTIGATE`). Edit `INVESTIGATOR_SYSTEM_INSTRUCTIONS` / `SKEPTIC_SYSTEM_INSTRUCTIONS` in
   `lib/nexus/tasks/agentInstructions.ts` — this is now the one and only place either string lives. For an
   `INVESTIGATE`/`ANALYZE` task, leave these untouched.

That's the full list for an analytical task. `MATCH`/`OPTIMIZE`/document/image tasks need real new code
(a scoring or solver module, a different data adapter) — the registry above still tells you where its
*metadata* goes, but the decision logic itself is new work, not configuration.

---

## 4. Do not touch unless necessary

These are load-bearing for every investigation regardless of domain and have no reason to change for a
new tabular analytical task:

- `lib/nexus/agentic/orchestrator.ts` — agent budgets, revision logic, trace events
- `lib/nexus/agentic/liveInvestigator.ts` / `liveSkeptic.ts` — the LLM call harness itself (not the two
  instruction strings — those move, see §3.5)
- `lib/nexus/agentic/types.ts` — `EvidenceRecord`, `AgenticResult`, `PrecursorChain`
- `lib/engine/statistics.ts`, `lib/engine/inferentialStats.ts` — the statistics engine
- `lib/nexus/report/pdfReport.ts`, `reportModel.ts` — PDF generation
- `InvestigationWorkspace.tsx`'s Result rendering, Technical Trace
- `app/layout.tsx`, `CommandCenter.tsx`'s core layout

If a plan requires editing any of these for an ordinary analytical task, stop and reconsider — that's a
sign the task is being solved by rewriting infrastructure instead of configuring it.

---

## 5. Validation checklist

Run in this order after any change:

```
npm test
npm run typecheck
npm run lint
npm run build
```

Then a live smoke test — restart the dev server and check, for the new task:

- `/investigate` loads and the new task's data/objective can be selected or uploaded
- the investigation completes (or falls back safely without `OPENAI_API_KEY`)
- Risk Chain / findings show human-readable labels, not raw column IDs
- Technical Trace still shows canonical IDs and tool names
- "Скачать отчёт" produces a PDF and it contains the new task's content correctly

---

## 6. Where things already are

| Thing | Status | Location |
|---|---|---|
| Task registry | **exists** | `lib/nexus/tasks/taskRegistry.ts` |
| Agent instructions (extracted) | **exists** | `lib/nexus/tasks/agentInstructions.ts` |
| Domain tool-pack template | **exists, inert** | `lib/nexus/templates/domainToolPack.template.ts` |
| Generic tool pack | **exists** | `lib/nexus/agentic/toolRegistry.ts` |
| Display labels | **exists** | `lib/nexus/report/displayLabels.ts` |
| Tool-pack resolution | **exists** | `lib/nexus/agentic/resolveToolPack.ts` |
| Result-screen vocabulary override | **metadata only, not wired into UI** | `NexusTaskConfig.resultVocabulary` |
| OPTIMIZE / MATCH / ANALYZE agent behavior | **does not exist** | declared as `TaskMode` values only |

---

## Codex adaptation prompt

Paste this as the opening instruction once the challenge is known:

> You are adapting an existing production-ready agentic application (NEXUS) to a new hackathon challenge.
>
> First inspect the challenge and the existing NEXUS architecture (`docs/task-adaptation-quickref.md` is
> your map). Do not rewrite the core.
>
> Classify every relevant component as KEEP / CONFIGURE / ADAPT / ADD.
>
> Prefer using, unchanged:
> - the existing app shell and Command Center
> - dataset ingestion (CSV/XLSX upload, profiling)
> - the tool runtime and tool-pack interface
> - the Evidence layer and Technical Trace
> - the agent runtime (Observer → Investigator → Skeptic → Orchestrator)
> - PDF report export
>
> Only implement the task-specific layer the challenge actually requires: a task registry entry, display
> labels, a dataset adapter, and — only if the generic tools genuinely aren't enough — a new domain tool
> pack copied from `lib/nexus/templates/domainToolPack.template.ts`.
> TIME_SERIES runtime dispatch resolves through `resolveRuntimeToolPackScenario()`; do not add
> domain-specific conditions to the API route.
>
> Return, in this order, before changing any code:
> 1. TASK ANALYSIS (USER / PROBLEM / INPUT / DECISION / OUTPUT / SUCCESS CRITERIA)
> 2. TASK MODE (INVESTIGATE / ANALYZE / MATCH / OPTIMIZE)
> 3. REUSE PLAN (KEEP / CONFIGURE / ADAPT / ADD, per component)
> 4. FILES TO CHANGE (exact paths)
> 5. IMPLEMENTATION PLAN
>
> Only after that plan is confirmed, start implementing.
