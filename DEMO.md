# NEXUS jury demo

Target duration: 3–4 minutes. One upload-based walkthrough on the current generic engine.

There is no prepared demo case today — the previous build's reference verticals were removed so the
codebase reflects only reusable infrastructure. Prepare a dataset (or adapt one) before the demo per
[docs/task-adaptation-quickref.md](docs/task-adaptation-quickref.md); the outline below narrates whatever
domain that dataset represents.

## 0:00–0:20 — Problem

"A dashboard tells you a number crossed a threshold. It doesn't tell you what moved first, whether that
lead time is statistically real, or what a skeptical second reviewer would say before you act on it. NEXUS
investigates that gap."

## 0:20–2:00 — Investigation walkthrough

From the ordinary upload screen at `/investigate`, upload the prepared dataset. NEXUS profiles it and
routes it to one of its recognized data shapes on its own — no domain picker, no manual override needed
for a well-formed file.

- Point at **Investigator** — it picked one deterministic tool from the resolved pack itself; it did not
  compute the number.
- Point at the **relationship cards** — each shows a measured lag, a strength label, and whether it is
  statistically significant after Holm correction. Open one card's "Технические данные" disclosure to show
  the raw `r`, `lag`, `n`, `p-value`, and every tested lag — not just the winning one.
- Point at **Skeptic** — it independently reviewed the hypothesis and either supports, challenges, or stays
  inconclusive; show its own cited Evidence.
- Point at **Validator: VALIDATED** — say explicitly that this means the whole artifact was recomputed
  from the raw rows and hashed, not just checked once.
- Point at the **uncertainty list** — "Причинно-следственная связь не установлена" is always the first
  line, regardless of what the LLM said.
- Click **Подготовить и проверить экспорт** — show the export reaching `VERIFIED`, and read the on-screen
  line stating this is a controlled export for an operator, not an executed intervention.

## 2:00–2:40 — Domain Registry (if relevant to the chosen dataset)

If the dataset's columns match a registered domain (`RETAIL`, `LOGISTICS`, `MANUFACTURING`, `MINING`),
show that its columns resolve automatically against the Domain Registry (`status: RESOLVED`,
`source: SCHEMA_MATCH`) — the same six generic tools run regardless, purely reasoning from
registry-declared metric metadata and column-name matching, not a domain-specific code path.

## 2:40–3:20 — Close

"One core: a domain-agnostic engine plus a Domain Registry for column-name and metric resolution — every
number, regardless of the domain the data comes from, is deterministic and independently re-verified
before an export is ever offered."

## Recovery strategy

Primary demo: run with `OPENAI_API_KEY` set (see [`.env.example`](.env.example)) when connectivity is
available — this gives live Investigator/Skeptic phrasing.

Fallback demo: remove or unset the key and reload. NEXUS falls back to a bounded, clearly-labeled
deterministic path — every Evidence record, the precursor chain, validation, and the export step are
unaffected, since none of them depend on the LLM being available. Only the phrasing of the
hypothesis/challenge changes to a fixed fallback statement.

## What this demo intentionally does not claim

- No proven causality — every lagged relationship is reported as an observed association, never a
  mechanism.
- No autonomous action — the only thing NEXUS ever executes is producing a reviewable export.
- No forecast — the deterministic tools describe what has already happened in the data, not what will
  happen next.
