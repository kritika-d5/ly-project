import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchCases, type CourtTier } from '../api';
import { ContentBadge, TierBadge } from '../components/Badges';
import CaseFileMark from '../components/CaseFileMark';
import Icon from '../components/Icon';
import { useDocumentTitle } from '../useDocumentTitle';

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

  useDocumentTitle(q ? `“${q}”` : null);

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
        <div className="mb-8 flex flex-col-reverse items-center gap-4 sm:flex-row sm:justify-between sm:gap-8">
          <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Search bail jurisprudence by meaning
          </h1>
          <p className="mt-2 text-sm text-stone-600 max-w-2xl">
            Ask in plain English. Results are ranked across 198 judgments using both semantic
            similarity and exact term matching, so a question about financial crimes finds the
            right passage even when it never uses that phrase.
          </p>
          </div>
          <CaseFileMark className="w-44 shrink-0 sm:w-56" />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400"
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. when is bail refused for economic offences"
          className="w-full rounded-md border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm
                     outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
        />
        </div>
        <button
          type="submit"
          className="rounded-md bg-maroon-800 px-5 py-2.5 text-sm font-medium text-white transition-colors
                     hover:bg-maroon-700 disabled:opacity-50"
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
                ? 'border-maroon-800 bg-maroon-800 text-white'
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
                  className="group flex items-center gap-2 text-sm text-stone-700
                             transition-colors hover:text-maroon-700"
                >
                  <Icon
                    name="chevronRight"
                    size={13}
                    className="text-gold-500 transition-transform group-hover:translate-x-0.5"
                  />
                  <span className="underline decoration-gold-300 underline-offset-4
                                   group-hover:decoration-maroon-500">
                    {ex}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isFetching && <p className="mt-8 text-sm text-stone-500">Searching&hellip;</p>}
      {error && (
        <p className="mt-8 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
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
              <li
                key={r.tid}
                className="rounded-lg border border-stone-200 bg-white p-4 transition-colors
                           hover:border-terracotta-300"
              >
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
                  <span className="flex items-center gap-1">
                    <Icon name="calendar" size={12} className="text-stone-400" />
                    {r.year || 'undated'}
                  </span>
                  {r.citedByCount > 0 && (
                    <span
                      title="How many other cases in this corpus cite it"
                      className="flex items-center gap-1"
                    >
                      <Icon name="network" size={12} className="text-stone-400" />
                      cited by {r.citedByCount}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Icon
                      name={r.hasPdf ? 'document' : 'text'}
                      size={12}
                      className="text-stone-400"
                    />
                    {r.hasPdf ? 'official PDF' : 'text only'}
                  </span>
                  {r.layer === 'seed' && (
                    <span className="rounded-sm bg-gold-100 px-1.5 py-0.5 text-gold-700">landmark</span>
                  )}
                </div>

                <ul className="mt-3 space-y-2">
                  {r.passages.map((p) => (
                    <li key={p.id} className="border-l-2 border-gold-200 pl-3">
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
