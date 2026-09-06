import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getCaseText, type ContentType } from '../api';
import { KanoonSourceNote } from './Attribution';
import { ContentBadge } from './Badges';

/**
 * The judgment as the system actually holds it: chunks in document order, each
 * labelled with who is speaking. This is both the reading fallback for the 58
 * cases with no official PDF, and — more usefully — an honest window into
 * exactly what the chatbot can see.
 */
export default function TextViewer({ tid }: { tid: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['caseText', tid],
    queryFn: () => getCaseText(tid),
  });
  const [hideQuoted, setHideQuoted] = useState(false);

  if (isLoading) return <p className="text-sm text-stone-500">Loading judgment&hellip;</p>;
  if (error) {
    return <p className="text-sm text-vermilion-700">{(error as Error).message}</p>;
  }
  if (!data) return null;

  const OWN: ContentType[] = ['court_text', 'editorial'];
  const shown = hideQuoted ? data.chunks.filter((c) => OWN.includes(c.contentType)) : data.chunks;
  const quotedCount = data.chunks.length - data.chunks.filter((c) => OWN.includes(c.contentType)).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-stone-500">
          {data.count} passages &middot; {quotedCount} of them are quoted material rather than
          this court&rsquo;s words
        </span>
        <label className="flex items-center gap-2 text-stone-600">
          <input
            type="checkbox"
            checked={hideQuoted}
            onChange={(e) => setHideQuoted(e.target.checked)}
            className="accent-maroon-700"
          />
          Show only what this court wrote
        </label>
      </div>

      <div className="space-y-4">
        {shown.map((c) => (
          <div key={c.id} id={c.id}>
            <div className="mb-1 flex items-center gap-2">
              <ContentBadge type={c.contentType} />
              {c.locator && <span className="text-[11px] text-stone-400">{c.locator}</span>}
            </div>
            <p
              className={`judgment-text text-[15px] whitespace-pre-wrap ${
                c.contentType === 'court_text'
                  ? 'text-stone-800'
                  : 'border-l-2 border-stone-200 pl-4 text-stone-600'
              }`}
            >
              {c.text}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 border-t border-stone-200 pt-4">
        <KanoonSourceNote what="This judgment text and its structural labels are" />
      </div>
    </div>
  );
}
