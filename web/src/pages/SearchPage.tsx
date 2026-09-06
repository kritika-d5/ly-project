import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchCases, type CourtTier } from '../api';
import { ContentBadge, TierBadge } from '../components/Badges';

const EXAMPLES = [
  'when can anticipatory bail be granted',
  'bail in economic offences and flight risk',
  'default bail under Section 167(2)',
  'delay in trial as a ground for bail under UAPA',
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tier = (params.get('courtTier') ?? '') as CourtTier | '';
  const [draft, setDraft] = useState(q);

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', q, tier],
    queryFn: () => searchCases({ q, courtTier: tier }),
    enabled: q.trim().length > 1,
  });

  const submit = (next: string, nextTier: CourtTier | '' = tier) => {
    const p = new URLSearchParams();
    if (next.trim()) p.set('q', next.trim());
    if (nextTier) p.set('courtTier', nextTier);
    setParams(p);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {!q && (
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Search bail jurisprudence by meaning
          </h1>
          <p className="mt-2 text-sm text-stone-600 max-w-2xl">
            Ask in plain English. Results are ranked across 198 judgments using both semantic
            similarity and exact term matching, so a question about financial crimes finds the
            right passage even when it never uses that phrase.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. when is bail refused for economic offences"
          className="flex-1 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm
                     outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
        />
        <button
          type="submit"
          className="rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-white
                     hover:bg-stone-700 disabled:opacity-50"
          disabled={draft.trim().length < 2}
        >
          Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Court:</span>
        {([['', 'All'], ['SC', 'Supreme Court'], ['HC', 'High Court']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => submit(q || draft, v)}
            className={`rounded-full border px-2.5 py-1 ${
              tier === v
                ? 'border-stone-800 bg-stone-800 text-white'
                : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!q && (
        <div className="mt-8">
          <p className="text-xs uppercase tracking-wide text-stone-400">Try</p>
          <ul className="mt-2 space-y-1.5">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  onClick={() => {
                    setDraft(ex);
                    submit(ex);
                  }}
                  className="text-sm text-stone-700 underline decoration-stone-300
                             underline-offset-4 hover:decoration-stone-600"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isFetching && <p className="mt-8 text-sm text-stone-500">Searching&hellip;</p>}
      {error && (
        <p className="mt-8 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          <p className="mt-8 text-xs text-stone-500">
            {data.count} cases &middot; {data.tookMs} ms
          </p>
          <ol className="mt-3 space-y-4">
            {data.results.map((r) => (
              <li key={r.tid} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <Link
                    to={`/case/${r.tid}`}
                    className="font-medium text-stone-900 hover:underline underline-offset-4"
                  >
                    {r.title}
                  </Link>
                  <TierBadge tier={r.courtTier} />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span>{r.year || 'undated'}</span>
                  {r.citedByCount > 0 && (
                    <span title="How many other cases in this corpus cite it">
                      cited by {r.citedByCount}
                    </span>
                  )}
                  <span>{r.hasPdf ? 'official PDF' : 'text only'}</span>
                  {r.layer === 'seed' && (
                    <span className="text-stone-400">landmark</span>
                  )}
                </div>

                <ul className="mt-3 space-y-2">
                  {r.passages.map((p) => (
                    <li key={p.id} className="border-l-2 border-stone-200 pl-3">
                      <div className="mb-1 flex items-center gap-2">
                        <ContentBadge type={p.contentType} />
                        {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
                      </div>
                      <p className="judgment-text text-[13px] text-stone-700 line-clamp-3">
                        {p.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {data.count === 0 && (
            <p className="mt-6 text-sm text-stone-500">
              Nothing matched. Try describing the situation rather than naming a case.
            </p>
          )}
        </>
      )}
    </div>
  );
}
