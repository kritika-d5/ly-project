import { useMutation } from '@tanstack/react-query';
import { getSummary } from '../api';
import { ContentBadge } from './Badges';

/**
 * Issue / Held / Principle, generated on demand rather than on page load —
 * a summary costs a model call, and most visits to a case page are to read it,
 * not to have it paraphrased.
 */
export default function SummaryPanel({ tid }: { tid: number }) {
  const { mutate, data, isPending, error } = useMutation({
    mutationFn: () => getSummary(tid),
  });

  if (!data && !isPending) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-medium text-stone-900">Generate a structured summary</h3>
        <p className="mt-1.5 text-sm text-stone-600">
          Issue, holding, and the principle the case is cited for &mdash; drawn only from the
          court&rsquo;s own words and the reporter&rsquo;s headnote, never from quoted material.
        </p>
        <button
          onClick={() => mutate()}
          className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white
                     hover:bg-stone-700"
        >
          Summarise
        </button>
        {error && (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {(error as Error).message}
          </p>
        )}
      </div>
    );
  }

  if (isPending) return <p className="text-sm text-stone-500">Reading the judgment&hellip;</p>;

  return (
    <div>
      <div className="judgment-text whitespace-pre-wrap text-[15px] text-stone-800">
        {data!.summary}
      </div>

      <details className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-stone-600">
          Based on {data!.passages.length} passages
        </summary>
        <ol className="mt-3 space-y-3">
          {data!.passages.map((p, i) => (
            <li key={p.id} className="text-[13px]">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[11px] text-stone-400">[{i + 1}]</span>
                <ContentBadge type={p.contentType} />
                {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
              </div>
              <p className="judgment-text text-stone-600 line-clamp-3">{p.text}</p>
            </li>
          ))}
        </ol>
      </details>

      <p className="mt-4 text-xs text-stone-500">
        Machine-generated from the judgment text. Verify against the judgment before relying on it.
      </p>
    </div>
  );
}
