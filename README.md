# NEXUS

**Autonomous Risk Investigation System.**

NEXUS does not just forecast risk. It investigates how an economic risk is emerging and what it could become — and it keeps a hard line between what an AI agent *decides to check* and what a deterministic engine *computes*.

> NEXUS не просто прогнозирует риск. Он расследует, как экономический риск возникает и во что может превратиться.

## 1. Problem

Most monitoring dashboards answer "is a metric above a threshold?" They rarely answer the two questions an analyst, credit officer, or site manager actually needs:

- *Why* is this metric moving — which other signals moved first, and by how much lead time?
- *How sure should I be* — is this a statistically real, still-unproven association, or noise?

A red KPI tile does not investigate itself. Someone still has to pull the data, check what moved earlier, sanity-check the story against an alternative explanation, and decide whether it is worth acting on.

## 2. Who has this problem

Anyone who owns a recurring risk metric and gets only the metric, not the investigation behind it:

- a **construction PM** watching schedule slip against procurement and FX exposure;
- a **credit risk / portfolio analyst** watching a default rate against funding cost and delinquency;
- a **government service manager** watching request backlogs and repeat-complaint rates across departments.

## 3. Why monitoring alone is insufficient

A threshold alert tells you *that* something is wrong. It does not tell you which upstream signal moved first, whether that lead time is statistically meaningful given the sample size, or what a skeptical second reviewer would say before anyone acts on it. Doing that by hand, per metric, per report cycle, does not scale — and doing it with an LLM alone (no deterministic check) means numbers can be hallucinated.

## 4. Solution

NEXUS takes an uploaded (or prepared) dataset and runs a bounded, explainable investigation: it detects what changed, lets an LLM **Investigator** choose which deterministic tool to run next, computes every number with ordinary statistics (Pearson correlation, lag scanning, Holm-corrected significance, bootstrap stability), has an LLM **Skeptic** attempt to challenge the resulting hypothesis, deterministically **validates** the whole artifact by recomputing it from the raw data, and only then offers a **controlled export** — never an autonomous action.

## 5. How NEXUS works

```text
Data → Detect → Investigate → Evidence → Challenge → Validate → Act
```

1. **Detect** — the uploaded table is profiled and routed to one of four recognized data shapes (`TIME_SERIES`, `CROSS_SECTIONAL`, `EVENT_TRANSACTION`, `AMBIGUOUS_TABULAR`). Unrecognized shapes get a `NEEDS_INPUT`/`UNSUPPORTED` decision, not a forced result.
2. **Investigate** — the Investigator agent picks one deterministic tool from the resolved tool pack (generic, or a domain-specific pack) and calls it. It never computes a number itself.
3. **Evidence** — every tool call returns an `EvidenceRecord`: a tool name, the exact inputs, and the exact computed output. Evidence is never edited by the UI layer, only relabeled for display.
4. **Challenge** — the Skeptic agent reviews the Investigator's hypothesis, can call its own deterministic tool, and returns `SUPPORTED` / `CHALLENGED` / `INCONCLUSIVE` plus alternative explanations.
5. **Validate** — a separate deterministic validator recomputes the entire artifact from the raw rows and hashes it. If the recomputation does not match, the run is not `VALIDATED` and no export is offered.
6. **Act** — only a `VALIDATED` artifact can produce a controlled export (a CSV/JSON decision package for a human operator). NEXUS never executes a financial, scheduling, or operational intervention itself.

Causality is always reported as `NOT_ESTABLISHED`. See [§9](#9-evidence-and-validation).

## 6. What the prototype currently demonstrates

NEXUS ships as a **domain-agnostic core**: upload any tabular dataset and it is profiled, routed to one of four recognized data shapes, and investigated through the generic deterministic tool pack (six tools: `profile_dataset`, `inspect_series`, `calculate_correlation`, `detect_outliers`, `inspect_missingness`, `inspect_directional_movement`) — no domain-specific code path is required for an ordinary investigation to run end to end.

The Domain Registry (`lib/nexus/domains/`) additionally ships four registered metric vocabularies — `RETAIL`, `LOGISTICS`, `MANUFACTURING`, `MINING` — proving the registry mechanism itself (column-alias resolution, detection scoring) works across genuinely different domains, purely from declarative metadata; none of them has a specialized deterministic tool pack or a prepared Command Center scenario today. Adding one, for a new domain identified by an actual task brief, follows the pattern in [§21](#21-hackathon-adaptation-model).

## 7. Agentic investigation

```text
Investigator → deterministic tool → Evidence → Skeptic → validated result
```

Two live LLM roles (`gpt-5-mini` by default, `OPENAI_MODEL` overridable), each constrained to a fixed JSON-schema action space and a small tool catalog:

- **Investigator** — chooses one tool from the resolved pack, forms a primary hypothesis and one alternative explanation, cites only Evidence IDs that actually exist.
- **Skeptic** — reviews the hypothesis, may run one more tool, returns a verdict and its own alternatives.

Without `OPENAI_API_KEY`, or if a call times out or fails validation, NEXUS falls back to a bounded, clearly-labeled deterministic fallback path — it never blocks the investigation on an LLM being available.

## 8. Reasoning vs Computation

This is the one invariant every other design choice in NEXUS defers to:

| | Decides | Never does |
|---|---|---|
| **LLM / Agents** (Investigator, Skeptic) | which tool to call, how to phrase a hypothesis/challenge, which alternative to raise | compute a statistic, invent a number, assert proven causality |
| **Deterministic code** (`lib/engine`, `lib/nexus/agentic/precursorChain.ts`, tool packs) | every correlation, lag, p-value, confidence interval, bootstrap result, validation hash, action eligibility | interpret meaning, choose what to investigate |

A validator never trusts an agent's stated number — it recomputes the whole artifact from the raw dataset and compares hashes.

## 9. Evidence and validation

- **Evidence** (`EvidenceRecord`): `{ id, tool, variables, result, data }` — produced only by a deterministic tool execution, never edited afterward. Display code (`lib/nexus/report/displayLabels.ts`) may relabel the *text shown to a user*, but never the stored record.
- **Precursor chain**: for each candidate signal, correlation against the mapped target is scanned across lags 0–3 (`lib/nexus/agentic/precursorChain.ts`), keeping every tested lag, Holm-correcting significance across that scan, and computing a Fisher-z confidence interval and a moving-block bootstrap stability label. Causality is always reported `NOT_ESTABLISHED` — a lagged, significant correlation is co-movement with a lead time, not a proven mechanism.
- **Validation**: `validateTimeSeriesArtifact` (and the Cross-Sectional/Event equivalents) independently recompute the artifact from the raw dataset and diff it against the one produced during the run. Only a `VALIDATED` result can reach the Action layer.

Full statistical detail: [docs/methodology.md](docs/methodology.md).

## 10. Action model

`runExportDecisionAction` (`lib/nexus/action/exportDecision.ts`) is domain-agnostic and gates on a `VALIDATED` artifact:

```text
PROPOSED → POLICY_APPROVED → EXECUTED → VERIFIED
```

The only action NEXUS ever performs is producing a downloadable, re-verifiable export (a CSV of leading signals/flagged rows plus a JSON decision record) for a human operator to review. It never executes a financial, scheduling, or policy change itself — every result screen says so explicitly.

## 11. Architecture

```text
Upload/Prepared dataset
  → Universal admission (data-shape router: TIME_SERIES / CROSS_SECTIONAL / EVENT_TRANSACTION / AMBIGUOUS_TABULAR)
  → Task Registry + Domain Registry (declarative runtime-capability resolution)
  → Tool pack (generic, or a domain-specific deterministic pack)
  → Agent runtime (Investigator → Skeptic)
  → Deterministic validator (recompute-and-diff)
  → Action layer (controlled export)
```

TIME_SERIES and the Cross-Sectional/Event-Transaction workflows use separate, hardened agent runtimes within the current upload pipeline. Domain dispatch for TIME_SERIES is declarative (`resolveRuntimeToolPackScenario` in `lib/nexus/tasks/taskRegistry.ts`) — adding a domain without a dedicated tool pack needs no API-route or agent-runtime changes.

One consequence of the split worth recording rather than rediscovering: TIME_SERIES's generic tool pack has a `"pair"` argument kind (`{left, right}`, e.g. `calculate_correlation`) whose two fields are independent `strict:true` JSON-schema enums — nothing stops the model picking the same column for both, which is why `liveInvestigator.ts`/`liveSkeptic.ts` carry a bounded one-shot argument-repair step for exactly that collision. The bounded runtime's `BoundedToolArgumentKind` (`lib/nexus/agentic/boundedRuntime/runtime.ts`) is typed as `"none" | "id"` only — no CROSS_SECTIONAL/EVENT_TRANSACTION tool has ever taken a two-column pair argument, so this specific failure mode cannot occur there by construction, not just by current tool choices. The bounded runtime's own gap is different: any schema/argument/evidence failure there falls straight to the deterministic fallback with no repair attempt at all — always safe, just more fallback-prone than the repaired TIME_SERIES path.

## 12. Domain Registry and Domain Packs

`lib/nexus/domains/` holds one file per domain: canonical metric definitions (id, Russian label, unit, risk direction, aliases), detection thresholds, and (optionally) causal priors and a scenario config.

Registered today: `RETAIL`, `LOGISTICS`, `MANUFACTURING`, `MINING` — vocabulary/detection metadata only, no deterministic tool pack, no scenario; they demonstrate registry breadth, not prepared demo verticals.

Runtime capability resolution (`resolveRuntimeToolPackScenario`) is a pure function: an explicit task wins outright; otherwise an ordinary upload's resolved domain may link to a registered task's tool pack; an unregistered or tool-pack-less domain always falls back to the generic engine. No domain name ever appears as a branch inside the generic agents or the API route.

## 13. Practical applications

- **Where**: any organization with a recurring tabular risk metric and no dedicated data-science team to chase every anomaly by hand.
- **By whom**: a risk/ops analyst, PM, or department head who needs a first-pass investigation before escalating.
- **What it supports**: descriptive investigation, hypothesis formation and challenge, a validated evidence package, and a controlled export for a human decision.
- **What it does not automate**: it does not decide policy, does not execute a financial/operational action, and does not claim proven causality. Every export exists to be reviewed by a person, not to trigger anything automatically.

## 14. Development potential

The current build intentionally proves breadth (Domain Registry, generic runtime) without building out any specific vertical, so the next domain is added to fit an actual task rather than retrofitted around a pre-built demo:

- **A scenario/intervention panel or specialized tool pack for a registered domain** — `RETAIL`/`LOGISTICS`/`MANUFACTURING`/`MINING` already have canonical metric vocabularies; `lib/nexus/templates/domainToolPack.template.ts` is a ready starting shape for a new tool pack.
- **Specialized deterministic tool packs** for a new domain, only where the generic six tools genuinely cannot express the needed calculation.
- **Additional data shapes / task modes** — `OPTIMIZE`/`MATCH`/`ANALYZE` are declared as `TaskMode` values today but have no agent behavior yet; `INVESTIGATE` is the only implemented mode.
- **Human Challenge / re-investigation loop, persistent investigation history, additional export integrations, optimization/allocation engines** — none of these exist yet; they are future directions, not implemented features.
- **Fast adaptation to a new hackathon task** — see [§21](#21-hackathon-adaptation-model) and [docs/task-adaptation-harness.md](docs/task-adaptation-harness.md).

## 15. Limitations

- Causality is never established — every lagged association is reported as an observed, statistically-scanned co-movement, explicitly not a proven mechanism.
- `OPTIMIZE`/`MATCH`/`ANALYZE` task modes are declared but not implemented; only `INVESTIGATE` runs today.
- No domain currently has a specialized deterministic tool pack or a prepared Command Center demo scenario — every investigation today runs on the generic six-tool pack.
- No persistence layer: every investigation exists only for the browser session that ran it.
- Production-ready code hardening (rate limiting, auth, multi-tenant isolation) is out of scope for this prototype.

## 16. Demo

See [DEMO.md](DEMO.md) for the jury walkthrough script and the no-network fallback behavior.

## 17. Run locally

Requires Node.js (developed and tested on Node 24).

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then upload any tabular dataset (CSV/XLSX) via the ordinary upload flow at `/investigate` — there is no prepared demo case today; see [§21](#21-hackathon-adaptation-model) for adding one.

Production build:

```bash
npm run build
npm run start
```

## 18. Environment variables

Optional — see [`.env.example`](.env.example). Without `OPENAI_API_KEY`, NEXUS runs entirely on its deterministic fallback path (still fully explorable, just without live LLM phrasing).

```text
OPENAI_API_KEY=      # optional; enables live Investigator/Skeptic reasoning
OPENAI_MODEL=        # optional; defaults to gpt-5-mini
```

Never commit `.env.local`; it is already excluded via `.gitignore`.

## 19. Tests / verification

```bash
npm test          # node --test lib/**/*.test.ts
npm run typecheck # tsc --noEmit
npm run lint      # eslint .
npm run build     # next build
```

The test count is reported by the current `npm test` run.

## 20. Repository structure

```text
app/                       Next.js routes (/ and /investigate)
components/nexus/          UI: Command Center, Investigation Workspace, Decision View
lib/engine/                Domain-agnostic statistics (Pearson, inferential stats, bootstrap)
lib/nexus/universal/       Data-shape admission/routing (TIME_SERIES/CROSS_SECTIONAL/EVENT_TRANSACTION/AMBIGUOUS_TABULAR)
lib/nexus/domains/         Domain Registry: one file per domain (metrics, aliases, detection, scenario)
lib/nexus/tasks/           Task Registry + runtime capability resolution + agent instructions
lib/nexus/agentic/         Investigator/Skeptic runtime, tool pack interface, Evidence, precursor chain
lib/nexus/templates/       Inert starting shape for a new domain's tool pack
lib/nexus/crossSectional/  Cross-sectional workflow (bounded runtime)
lib/nexus/eventTransaction/Event/transaction workflow (generic)
lib/nexus/timeSeries/      Deterministic artifact + validator
lib/nexus/action/          Domain-agnostic controlled export/action layer
lib/nexus/report/          Presentation-only: display labels, view models, PDF report
lib/nexus/demo/            Prepared demo datasets + scenario registry
demo/data/                 Sample files
docs/                      Methodology and hackathon-adaptation documentation
```

## 21. Hackathon adaptation model

This repository is a **reference implementation** — the actual submission adapts this infrastructure to whatever technical specification is announced on-site, following:

```text
Read the spec → decide if NEXUS fits → inspect the dataset → choose/adapt a Domain Pack
→ resolve runtime capability → map schema → define the objective → run the pipeline
→ add domain computation only if required → define a safe action → verify → rewrite presentation
```

The full step-by-step procedure, a real file map with safe/unsafe change boundaries, a coding-agent prompt template, and a review checklist live in [docs/task-adaptation-harness.md](docs/task-adaptation-harness.md). A narrower, TIME_SERIES-specific quick reference is at [docs/task-adaptation-quickref.md](docs/task-adaptation-quickref.md).
