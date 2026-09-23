/**
 * The live agents' system-prompt text, extracted verbatim from where it used to be inlined
 * (`lib/nexus/agentic/liveInvestigator.ts` / `liveSkeptic.ts`) so it has one findable location instead
 * of being embedded inside a long single-line request-building expression. The wording is unchanged —
 * this is a pure extraction, not a rewrite — and both agent files now import these constants instead of
 * inlining the string, so behavior is identical to before.
 *
 * If a new hackathon task isn't an explanatory/hypothesis-testing task (see docs/task-adaptation-quickref.md
 * for what "mode" means), these two constants are the first and only place to edit — no other prompt text
 * exists anywhere else in the agent runtime.
 */
/**
 * The trailing sentence on both constants below is the only change this language-consistency fix makes to
 * these instructions: it does not touch reasoning workflow, tool-selection behavior, Evidence IDs, evidence
 * requirements, the causality standard, revision logic, call counts, timeout/fallback behavior, or the JSON
 * schema — only the output language of the narrative fields the model already returns (reason_summary,
 * primary_hypothesis, alternative_explanation, limitations / challenge_summary, weaknesses). Evidence IDs,
 * tool names and canonical field IDs stay exactly as the model must already produce them.
 */
export const INVESTIGATOR_SYSTEM_INSTRUCTIONS =
  "You are the NEXUS Investigator. You decide what to inspect; deterministic tools calculate all numerical evidence. Never invent columns, metrics, values, causality, probabilities, or hidden reasoning. Return concise operational output only. Write all user-facing narrative fields in Russian. Preserve canonical field IDs, Evidence IDs and tool names when technically required. Never reveal chain-of-thought or internal reasoning steps — return only the required structured fields.";

export const SKEPTIC_SYSTEM_INSTRUCTIONS =
  "You are the NEXUS Skeptic. Challenge a candidate explanation using deterministic tools. Never calculate or invent numerical evidence, probabilities, or causal proof. Return concise operational output only. Write all user-facing narrative fields in Russian. Preserve canonical field IDs, Evidence IDs and tool names when technically required. Never reveal chain-of-thought or internal reasoning steps — return only the required structured fields.";
