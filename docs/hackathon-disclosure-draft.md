# Disclosure draft — paste into the final README at T0

Required by Положение §6.4 (disclose use of previously created code) and directly avoids the §12.2
disqualification ground ("presenting a project fully or predominantly created by third parties without
disclosing this fact"). Fill in the bracketed parts once the actual task is known; keep the tone factual,
not defensive.

---

## Disclosure: what was prepared before the competitive window

This project builds on a reusable, domain-agnostic infrastructure ("harness") the team prepared ahead of
the competitive window, using Claude Code (AI coding agent; permitted under Положение §6.9):

- A Next.js application scaffold and deployment configuration.
- A data-ingestion layer: CSV/XLSX parsing (quote-aware, multi-sheet with a sheet picker, tolerant of
  Russian date formats, thousands separators and localized headers).
- An agentic investigation pattern — an LLM Investigator/Skeptic loop that chooses which deterministic
  tool to run, backed by an Evidence + independent-recompute validation layer, so the LLM can never
  fabricate a number that reaches the result screen.
- A generic statistics engine (correlation with lag scanning, Fisher-z confidence intervals, moving-block
  bootstrap, Holm-corrected significance).
- A Domain Registry mechanism for resolving a dataset's columns against a domain's metric vocabulary —
  populated today with vocabulary-only entries for Retail, Logistics, Manufacturing and Mining (no
  business logic, no dataset, no solved task for any of them).
- A controlled PDF/export reporting layer.

**No domain-specific business logic, dataset, or solved task was included in this base.** Specifically for
**[chosen track, e.g. Логистика]**, everything below was built during the competitive window:

- [ ] Dataset/schema adapter for the actual task data — `[file(s)]`
- [ ] Task Registry entry / display labels — `[file(s)]`
- [ ] Domain-specific deterministic tool pack, if the generic six tools weren't enough — `[file(s), or "not needed — generic tools covered it"]`
- [ ] Result-screen wording/UI adaptation for this task
- [ ] `[anything else built live]`

Commit history in this repository from the official start time onward reflects this work.
