# Reproducibility checklist — run for real before submitting

Положение §7.4 ("Воспроизводимость и готовность к развёртыванию", 20 pts) and §8.7 require that a judge
can independently deploy, run, and verify the project from the repository alone, in a clean environment.
§8.9 makes failing this a disqualification ground **only** where the published mandatory admission
conditions say so — treat it as a hard requirement regardless, not a soft nice-to-have.

Run this literally, in a fresh clone, not just "it worked on my machine during development":

- [ ] `git clone` the actual submission repo into a brand-new directory (not the one you've been working in).
- [ ] `npm install` completes with no manual intervention (no missing peer-dep warnings that actually break
      the build, no undocumented global tool required).
- [ ] `.env.example` exists, is accurate, and lists every env var the app actually reads — no env var used
      in code that isn't documented there.
- [ ] Without any `.env.local` present, `npm run dev` starts and the app is usable (deterministic fallback
      path) — the app must not hard-crash just because `OPENAI_API_KEY` is unset.
- [ ] With a real `OPENAI_API_KEY` set (copy `.env.example` → `.env.local`, fill in the key), the live
      LLM path works too.
- [ ] `npm run build && npm run start` succeeds — the production path, not just `dev`.
- [ ] Follow the README's own "How to verify the main scenario" steps verbatim, from this fresh clone,
      pretending you are a judge who has never seen the code. If a step is unclear or wrong, fix the README,
      not just your own mental model of how it works.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all pass on the fresh clone.
- [ ] No hardcoded absolute local file paths anywhere (grep for your own username/local directory structure).
- [ ] No secrets committed — `.env.local` is gitignored, no API key is pasted anywhere in tracked files,
      commit messages, or code comments.
- [ ] The repo has no leftover local-only branches or uncommitted work the judges won't see — what's
      pushed to the default branch at lock time (§6.10) is literally the only thing that gets evaluated.
