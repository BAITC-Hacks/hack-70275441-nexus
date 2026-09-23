# AGENTS.md

Stable invariants for any agent (human, Codex, Claude Code) working on this repository. Detailed
hackathon-adaptation procedure lives in `docs/task-adaptation-harness.md`, not here — this file is
short on purpose and should stay that way.

## Non-negotiable invariants

1. **Reasoning vs Computation.** LLM agents (Investigator, Skeptic) decide *what* to investigate and *which*
   allowed deterministic tool to call. They never compute a statistic themselves, and their prose is never
   parsed for a number.
2. **Evidence authority.** An `EvidenceRecord` is produced only by a deterministic tool execution and is
   never edited afterward. Presentation code may relabel display text; it must never mutate the stored
   record or the underlying dataset.
3. **Causality is always `NOT_ESTABLISHED`.** A statistically significant, lagged correlation is reported as
   an observed association with a lead time — never as a proven mechanism, and never weakened language in
   the other direction either (no false certainty in either wording).
4. **No domain branches in generic code.** Domain/task dispatch happens in exactly one declarative place
   (`lib/nexus/tasks/taskRegistry.ts`'s `resolveRuntimeToolPackScenario` for TIME_SERIES). Never add
   `if domain === "..."` to the API route, the orchestrator, the generic agents, or the admission layer.
5. **Validation gates action.** Only a `VALIDATED` artifact (recomputed from raw data and hash-diffed) may
   reach the Action layer. The Action layer only ever produces a controlled export for a human — never an
   executed financial, scheduling, or policy change.
6. **Inspect before modifying.** Read the relevant file(s) and, where one exists, the closed-stage audit
   history before changing statistical core, agent runtime, validators, or Evidence contracts — these are
   closed unless a concrete regression is found.
7. **Tests before checkpoint.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
   `git diff --check` must all pass before any commit is proposed.
8. **No commit/push unless explicitly requested.** Implementation and hardening work stays uncommitted for
   human review unless the user explicitly asks for a commit.
9. **Never expose secrets.** Do not print, log, or commit `.env.local` or any real API key. `.env.example`
   holds placeholders only.
