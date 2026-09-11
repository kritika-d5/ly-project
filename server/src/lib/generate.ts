/**
 * Stage F — CounterEngine.md §6 (prompt contract) + §8.2 (output shape).
 *
 * Counter Engine v0 returned three rounds of passages and stopped there —
 * "a list of passages, not an answer." This module is the last step: one
 * Groq call that reads the position and everything actually retrieved, and
 * writes the research summary a lawyer would want, citing only what was
 * supplied.
 *
 * Reuses `COUNTER_ATTRIBUTION_RULES` from lib/llm.ts, which was written
 * ahead of this step specifically so the attribution rules live in exactly
 * one place (see that file's own comment). Does not duplicate them.
 *
 * WHAT v0 CANNOT CLAIM, and this prompt is deliberately honest about:
 *   - `opposing` round submissions carry `stanceUndetermined: true` — v0
 *     cannot tell pro-bail from anti-bail reliably (needs ARGUMENTS.md
 *     Stage B's applicant_seeking_bail, not built). The prompt must not let
 *     the model quietly assert a side these items don't actually carry.
 *   - There is no R4 rebuttal round (needs Stage C's outcome labels, not
 *     built) — no "this argument failed before" data exists yet. Hard Rule
 *     5 ("no strong counterargument found is a valid, expected output")
 *     extends here: if the corpus has no rebuttal, the answer must say so,
 *     not manufacture one from the graph-attack round alone.
 *   - §9 "No auto-drafting": this produces a research summary, not a
 *     document to file — the prompt says so explicitly.
 */
import { env } from '../config.js';
import { COUNTER_ATTRIBUTION_RULES, groq } from './llm.js';
import type { Classification, CounterItem, CounterRequest, RoundResult } from '../types.js';

const MAX_ITEMS_PER_ROUND = 8; // already the round size limits (SUPPORTING_LIMIT etc.) -- no further truncation needed, named for clarity
const MAX_PASSAGE_CHARS = 1200;

function courtNote(item: CounterItem): string {
  if (item.courtTier === 'HC') return ' — High Court, persuasive only, not binding';
  if (item.courtTier === 'OTHER') return ' — not Supreme Court, persuasive only';
  if (item.year && item.year < 1950) return ' — pre-1950, persuasive weight only';
  return '';
}

/** One numbered context block per retrieved item, in the exact format
 *  CounterEngine.md §6 specifies, extended for v0's honesty requirements
 *  (submissions carry no determined side; graph attacks carry becauseOf). */
function formatItem(n: number, item: CounterItem): string {
  const text = item.text.slice(0, MAX_PASSAGE_CHARS);
  const where = item.locator ? `, ${item.locator}` : '';
  const note = courtNote(item);

  if (item.kind === 'statute') {
    return `[${n}] STATUTE — ${item.caseTitle}${where} — quoted provision text, NOT a holding\n"${text}"`;
  }
  if (item.viaGraph) {
    const because = (item.becauseOf ?? [])
      .map((b) => `${b.title} (${b.polarity === 'neg' ? 'disagreed with' : 'distinguished in part'})`)
      .join('; ');
    return `[${n}] YOUR AUTHORITY WAS DOUBTED — ${item.caseTitle} (${item.year})${note}${where} — treats ${because}\n"${text}"`;
  }
  if (item.speaker === 'COUNSEL') {
    return `[${n}] SUBMISSION, SIDE NOT DETERMINED — ${item.caseTitle} (${item.year})${note}${where}\n` +
      `"${text}"\n(This is a party's argument as the court recorded it, not the court's own holding. This system cannot yet determine which side raised it or whether it succeeded — do not guess.)`;
  }
  return `[${n}] COURT'S REASONING — ${item.caseTitle} (${item.year})${note}${where}\n"${text}"`;
}

function buildContext(rounds: RoundResult[]): { block: string; n: number } {
  let n = 0;
  const parts: string[] = [];
  for (const round of rounds) {
    for (const item of round.items.slice(0, MAX_ITEMS_PER_ROUND)) {
      n += 1;
      parts.push(formatItem(n, item));
    }
  }
  return { block: parts.join('\n\n'), n };
}

const SYSTEM = `You are a legal research assistant. You write a research summary for a lawyer preparing a bail argument, from Indian Supreme Court bail jurisprudence.

${COUNTER_ATTRIBUTION_RULES}

Additional rules for this summary specifically:

7. This is a RESEARCH SUMMARY, not a document to file in court. Do not draft a petition, an application, or anything in filing form. You are surfacing what the corpus contains and helping a lawyer think, not producing a paragraph they would submit verbatim.
8. No confidence percentages or probability-of-success claims ("70% likely to succeed"). This corpus is 198 judgments; that kind of precision is not defensible and invites over-reliance.
9. Some submissions in the retrieved passages are marked SIDE NOT DETERMINED — this system could not tell whether they favour bail or oppose it. Present them as "a submission was made along these lines" without asserting which side made it, and without silently treating them as either supporting or opposing the user's position.
10. There is no rebuttal round in this version — if none of the retrieved passages show a prior court response to an opposing argument, do not invent one. Say plainly that the corpus does not show whether that specific argument succeeded elsewhere. This is expected, not a gap to paper over (Hard Rule 5: "no strong counterargument found" is a valid, honest answer).
11. Cite every claim by its passage number in square brackets, e.g. [3]. A claim with no bracket citation, or a citation number that was not supplied, is a failure. Use plain ASCII square brackets only — [3], never 【3】 or any other bracket style — so the citation can be checked and linked automatically.

Write in this structure, using only the passages supplied — never fill a gap from general legal knowledge:

## Your Position
Break the user's position into its separate premises. Note which one is weakest — per adversarial-reasoning practice, the weakest premise is the one worth attacking, and identifying it is useful even though this summary is written for the person holding that position.

## Your Case
The supporting law and any strong submissions on your side. Cite each claim.

## The Other Side
What the retrieved material suggests could be argued against this position — opposing-flavoured submissions (side not determined, say so), and any doubts raised against your own authorities via the citation graph. If nothing substantive was retrieved here, say so plainly rather than inventing an opposing argument.

## Restrictive Statutes
Only if statute passages were supplied. Otherwise omit this section entirely.

## What This Corpus Does Not Show
Be explicit about the gap: no rebuttal round exists yet, so if an opposing argument above has no shown outcome, say the corpus does not indicate whether it succeeded elsewhere.

## Sources
List every passage number you actually cited, with its case name and locator.`;

export interface GenerateResult {
  markdown: string;
  generationFailed: boolean;
  /** Hard Rule 4: "any case name in the output not in the retrieved set is a
   *  hallucination and must fail evaluation." Automatable half of that check
   *  (CounterEngine.md §12 item 2) -- every [N] the model cited must be
   *  within the numbered passages it was actually given. Non-empty means the
   *  model cited a number that doesn't exist; surfaced, not silently fixed. */
  invalidCitations: number[];
}

/** Extracts every [N] the model wrote and reports which ones fall outside
 *  1..maxN — the supplied passage range. */
function findInvalidCitations(markdown: string, maxN: number): number[] {
  const cited = new Set<number>();
  for (const m of markdown.matchAll(/\[(\d+)\]/g)) {
    cited.add(Number(m[1]));
  }
  return [...cited].filter((n) => n < 1 || n > maxN).sort((a, b) => a - b);
}

/** Synthesises the answer. Fails open to a plain notice (never a crash, never
 *  a silently-empty answer presented as if it were a real one) if Groq is
 *  unavailable — same posture as classify.ts and relevance.ts. */
export async function generateAnswer(
  req: CounterRequest,
  cls: Classification,
  rounds: RoundResult[],
): Promise<GenerateResult> {
  const { block, n } = buildContext(rounds);

  if (n === 0) {
    return {
      markdown: 'No supporting law, opposing material, or statutes were retrieved for this position. ' +
        'The corpus may simply have nothing on this specific point — that is an honest, expected outcome, not an error.',
      generationFailed: false,
      invalidCitations: [],
    };
  }

  if (!env.groqApiKey) {
    return { markdown: '', generationFailed: true, invalidCitations: [] };
  }

  const sideLabel = req.side === 'pro_bail' ? 'seeking bail' : 'opposing bail';
  const userPrompt = `POSITION (user is ${sideLabel}): ${req.position}\n\n` +
    `DETECTED TOPICS: ${cls.topics.join(', ') || 'none'}\n` +
    `OFFENCE CATEGORY: ${cls.offenceCategory}\n\n` +
    `RETRIEVED PASSAGES (cite ONLY these, by number):\n\n${block}`;

  try {
    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
    });
    const markdown = completion.choices[0]?.message?.content ?? '';
    if (!markdown.trim()) {
      return { markdown: '', generationFailed: true, invalidCitations: [] };
    }
    const invalidCitations = findInvalidCitations(markdown, n);
    if (invalidCitations.length) {
      // Not silently dropped or "fixed" -- Hard Rule 4 says this is a
      // failure, so it is surfaced to the caller (and the UI, per the
      // route) rather than quietly hidden from the response.
      console.error(`[generate] hallucinated citation number(s) outside 1-${n}:`, invalidCitations);
    }
    return { markdown, generationFailed: false, invalidCitations };
  } catch (err) {
    console.error('[generate] failed:', err);
    return { markdown: '', generationFailed: true, invalidCitations: [] };
  }
}
