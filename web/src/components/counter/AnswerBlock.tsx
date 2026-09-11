/**
 * Renders the Stage F synthesised answer (CounterEngine.md §6/§8.2).
 *
 * No markdown library added for this — the model's output shape is fixed
 * (## headings, plain paragraphs, [N] citation markers) by the prompt in
 * lib/generate.ts, so a small line-based renderer covers it without a new
 * dependency and without `dangerouslySetInnerHTML` on LLM output.
 */
interface AnswerBlockProps {
  markdown: string;
  generationFailed: boolean;
  invalidCitations: number[];
}

/** Splits "...text [3] more text [12] end" into alternating plain-text and
 *  citation-marker pieces, so [N] renders as a small badge rather than
 *  literal brackets in running prose. */
function renderInline(text: string, key: string) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <span key={key}>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center rounded bg-stone-100 px-1 text-xs font-medium text-stone-600"
          >
            {m[1]}
          </span>
        );
      })}
    </span>
  );
}

export default function AnswerBlock({ markdown, generationFailed, invalidCitations }: AnswerBlockProps) {
  if (generationFailed) {
    return (
      <p className="rounded-md border border-gold-200 bg-gold-50 p-3 text-sm text-gold-800">
        The retrieved passages are shown below, but a summary could not be generated this time.
      </p>
    );
  }
  if (!markdown.trim()) return null;

  const lines = markdown.split('\n');

  return (
    <div className="space-y-3">
      {invalidCitations.length > 0 && (
        <p className="rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-xs text-vermilion-700">
          This summary referenced a source number that was not part of the retrieved passages
          ({invalidCitations.join(', ')}). Treat the summary with extra care and verify against
          the sources below.
        </p>
      )}
      <div className="space-y-3 text-sm leading-relaxed text-stone-800">
        {lines.map((line, i) => {
          const heading = /^##\s+(.*)/.exec(line);
          if (heading) {
            return (
              <h3
                key={i}
                className="mt-6 text-xs font-semibold uppercase tracking-wide text-stone-500 first:mt-0"
              >
                {heading[1]}
              </h3>
            );
          }
          if (!line.trim()) return null;
          return <p key={i}>{renderInline(line, String(i))}</p>;
        })}
      </div>
    </div>
  );
}
