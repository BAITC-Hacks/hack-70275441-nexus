# Hourly checkpoint plan — draft

Положение §6.6 requires a confirmed intermediate result at the end of **every** reporting hour of the
competitive part; §12.2 makes missing one an explicit disqualification ground. Check the official schedule
once published — reporting-hour boundaries may not align exactly with "hour 1/2/3..." below; adjust the
split to match the real boundaries, keep the checklist content.

Primary track assumption: **Логистика** (registered vocabulary already in `lib/nexus/domains/logistics.ts`);
**Торговля** is the fallback if the actual ТЗ fits Retail better.

## Hour 0 — start

- Confirm OpenAI **and NVIDIA** API access is activated (per the organizers' "Активация OpenAI и NVIDIA для
  участников HackAlem AI" doc) — do this before the clock starts if at all possible, not as part of Hour 0.
- Pick the track, then pick exactly **one кейс** within it — the instructions explicitly say solving every
  кейс in a track is not required/expected.
- Squash `hackathon-core-prep` into one fresh commit, push to the team repo. The harness is already
  domain-free (all three prior verticals were removed) — nothing left to strip before pushing.
- Read the actual ТЗ for the chosen кейс. Decide: does it fit `INVESTIGATE`/`TIME_SERIES` (this engine's
  strength), or is it MATCH/OPTIMIZE-shaped (needs new solver logic)?
- **Checkpoint:** repo contains the harness commit + a short written note (commit message or a scratch file)
  stating the chosen track/кейс and why.

## Hour 1 — schema + data

- Build the dataset/schema adapter for the real task data (`lib/nexus/demo/` or wherever fits).
- Add the Task Registry entry (`lib/nexus/tasks/taskRegistry.ts`) and display labels
  (`lib/nexus/report/displayLabels.ts`).
- Confirm `resolveDatasetSchema` actually resolves the real columns (`SCHEMA_MATCH`, not a manual override).
- **Checkpoint:** a real commit showing the dataset loading and its columns resolving through the Domain
  Registry — even before agents run.

## Hour 2 — domain logic (only if needed)

- Only if the generic six tools genuinely can't express a needed calculation: add a domain tool pack from
  `lib/nexus/templates/domainToolPack.template.ts`, wire it into `resolveToolPack.ts`.
- If the task mode isn't plain `INVESTIGATE`, adjust `lib/nexus/tasks/agentInstructions.ts` — but treat this
  as the exception, not the default.
- **Checkpoint:** commit with the new tool logic (or a note that the generic tools already covered it) plus
  passing tests for it.

## Hour 3 — end-to-end + UI

- Run a full live investigation against the real task data; verify the result screen reads correctly in
  Russian, with correct labels, no leaked canonical IDs or English fallback text.
- Verify the deterministic-fallback path too (unset `OPENAI_API_KEY` briefly, confirm it still works).
- **Checkpoint:** a working live run, screenshotted or otherwise recorded, committed alongside any UI fixes.

## Hour 4 — tests, reproducibility, README

- `npm test && npm run typecheck && npm run lint && npm run build` — all green.
- Run the reproducibility checklist (`docs/hackathon-repro-checklist.md`) for real, from a clean clone if
  time allows.
- Fill in the README from `docs/hackathon-readme-template.md`, including the disclosure section from
  `docs/hackathon-disclosure-draft.md`.
- **Checkpoint:** green CI-equivalent run + README committed and readable end to end.

## Hour 5 — polish, rehearsal, submit

- Final pass on the README (content over visual polish — §7.4 scores content only).
- Rehearse the demo narration once.
- Confirm submission requirements/deadline (§6.2/§6.3) and push the final commit well before the repo locks
  (§6.10 — the platform closes write access automatically at the end of the competitive part).
- **Do not stop at the final push.** Per the organizers' instructions, go to the tracks page, open the
  chosen кейс, and click **«Сдать решение»** — fill in project name/description there. This is a separate
  platform action from the GitHub push; a perfect repo with no click here is an unsubmitted project. The
  submission can be updated up to the deadline, so do this early and re-click after any late fix.
- **Checkpoint:** final commit pushed AND «Сдать решение» confirmed submitted on the platform; no
  uncommitted work left locally.
