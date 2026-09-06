/**
 * Indian Kanoon attribution.
 *
 * Using the Kanoon API for a downstream product carries an obligation to
 * display a visible "Powered by IKanoon" credit (CLAUDE.md rule 10 in the data
 * repo). It is not decorative and it is not optional, so it lives in a shared
 * component rather than being retyped per page.
 *
 * The dependency is deeper than the phrase "citation data" suggests. Kanoon
 * supplied the judgment text itself, the citation graph, the rhetorical-role
 * labels on each paragraph, and the sentiment annotations that became citation
 * polarity. Effectively everything on screen except the official PDFs.
 */

const KANOON_URL = 'https://indiankanoon.org';

export function KanoonCredit({ className = '' }: { className?: string }) {
  return (
    <a
      href={KANOON_URL}
      target="_blank"
      rel="noreferrer"
      className={`font-medium text-stone-700 underline decoration-gold-300 underline-offset-4
                  hover:decoration-maroon-500 ${className}`}
    >
      Powered by IKanoon
    </a>
  );
}

/** The inline note shown wherever Kanoon-derived content is actually rendered. */
export function KanoonSourceNote({ what }: { what: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-stone-400">
      {what} sourced from Indian Kanoon. <KanoonCredit className="text-stone-500" />
    </p>
  );
}
