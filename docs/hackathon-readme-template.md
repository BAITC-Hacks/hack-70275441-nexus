# README template for the actual submission — fill at T0

Structured against Положение §7.4's README criterion (20 pts, content only — not visual design) and §8.8
(must include system requirements, dependencies, env vars). This README **replaces the pre-demo
presentation** — write for a reader who has never seen the project, not for the team.

Copy this structure into the real `README.md` in the hackathon repo and fill every `[...]`. Delete this
template file itself before submitting (it's a private planning artifact, not part of the product).

---

```markdown
# [Project name]

[One sentence: what it does and for whom.]

## Problem

[What real problem does this solve, for whom, in the chosen track/task? 2-4 sentences, concrete.]

## What is implemented

[Plain description of the main scenario, end to end: input → what happens → output. Be honest about
scope — only claim what actually works. This is what §7.4's "Соответствие кейсу и функциональность"
and "Техническая реализация" are scored against.]

## How it works

[Brief architecture: what the pipeline stages are, what's deterministic vs. what the LLM decides. Link to
deeper docs (docs/methodology.md, docs/task-adaptation-quickref.md) rather than duplicating detail here.]

## Disclosure

[Paste the filled-in docs/hackathon-disclosure-draft.md content here.]

## Tech stack and data

- **Stack:** [Next.js/React version, key libraries actually used]
- **Data:** [what dataset/data source the main scenario uses — synthetic/real, where it comes from]

## Installation and setup

**System requirements:** [Node version, OS notes if any]

```bash
npm install
```

**Environment variables** (see `.env.example`):

```text
OPENAI_API_KEY=   # optional; enables live LLM reasoning — see fallback note below
OPENAI_MODEL=     # optional; defaults to [model]
```

## Running the project

```bash
npm run dev     # development
# or
npm run build && npm run start   # production
```

Open `[URL/path]`.

## How to verify the main scenario

[Step-by-step, numbered, exact clicks/uploads/inputs a judge can follow with zero prior context to see the
result. This is what §8.7's "independently deploy, launch and verify" requirement is checked against —
be exhaustive here, this is the highest-leverage section of the whole README.]

1. [...]
2. [...]
3. [...]

## Known limitations

[Honest list — what doesn't work, what's out of scope, what would break on unusual input. Judges reward
honesty here per §7.4's basic-reliability criterion; don't oversell.]

## Team

[If relevant/required by the submission format — who worked on what, for §8.6's "фактический вклад
каждого участника".]
```
