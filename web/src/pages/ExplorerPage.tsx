import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGraph } from '../api';
import CitationGraph, { GraphLegend, type GraphLink, type GraphNode } from '../components/CitationGraph';

/**
 * The whole corpus as one picture: 198 judgments and the 336 citations between
 * them. Median degree is 2, so it lays out as a sparse web rather than a
 * hairball — readable, and the shape itself is a finding (a single connected
 * component held together by a handful of hubs).
 */
export default function ExplorerPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['graph'], queryFn: getGraph });
  const [tier, setTier] = useState<'all' | 'SC' | 'HC'>('all');
  const [onlyDisagreement, setOnlyDisagreement] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (tier === 'all') return data;
    const keep = new Set(data.nodes.filter((n) => n.courtTier === tier).map((n) => n.id));
    const idOf = (v: number | GraphNode) => (typeof v === 'number' ? v : v.id);
    return {
      nodes: data.nodes.filter((n) => keep.has(n.id)),
      links: data.links.filter(
        (l: GraphLink) => keep.has(idOf(l.source)) && keep.has(idOf(l.target)),
      ),
    };
  }, [data, tier]);

  const stats = useMemo(() => {
    if (!data) return null;
    const disagreements = data.links.filter(
      (l) => l.polarity === 'neg' || l.polarity === 'mixed',
    ).length;
    const hubs = [...data.nodes].sort((a, b) => b.degree - a.degree).slice(0, 5);
    return { disagreements, hubs };
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight text-stone-900">Citation explorer</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-stone-600">
        Every judgment in the corpus and the citations between them. An arrow runs from the citing
        case to the case it cites. Click any node to open it.
      </p>

      {isLoading && <p className="mt-8 text-sm text-stone-500">Loading the graph&hellip;</p>}
      {error && <p className="mt-8 text-sm text-rose-700">{(error as Error).message}</p>}

      {filtered && data && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-stone-500">Court:</span>
              {(
                [
                  ['all', 'All'],
                  ['SC', 'Supreme Court'],
                  ['HC', 'High Court'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTier(v)}
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
            <label className="flex items-center gap-1.5 text-stone-600">
              <input
                type="checkbox"
                checked={onlyDisagreement}
                onChange={(e) => setOnlyDisagreement(e.target.checked)}
                className="accent-stone-800"
              />
              Highlight the {stats?.disagreements} disagreements
            </label>
          </div>

          <p className="mt-2 text-xs text-stone-500">
            Showing {filtered.nodes.length} cases and {filtered.links.length} citations.
          </p>

          <div className="mt-3">
            <CitationGraph
              data={filtered}
              height={560}
              labelMode="hubs"
              highlightDisagreement={onlyDisagreement}
              onNodeClick={(n) => navigate(`/case/${n.id}`)}
            />
          </div>

          <GraphLegend className="mt-3" />

          {stats && (
            <div className="mt-8">
              <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
                Most cited within the corpus
              </h2>
              <ul className="mt-2 space-y-1.5">
                {stats.hubs.map((h) => (
                  <li key={h.id} className="flex items-baseline gap-3 text-sm">
                    <span className="w-8 shrink-0 tabular-nums text-right text-stone-400">
                      {h.degree}
                    </span>
                    <button
                      onClick={() => navigate(`/case/${h.id}`)}
                      className="text-left text-stone-700 underline decoration-stone-300
                                 underline-offset-4 hover:decoration-stone-600"
                    >
                      {h.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-6 text-[11px] text-stone-400">
            The graph is a deliberately narrow slice of bail jurisprudence, snowballed from eight
            landmark seeds &mdash; not a complete map of Indian citation practice. Treatment labels
            come from Indian Kanoon&rsquo;s annotations and have not been reviewed by a lawyer.
          </p>
        </>
      )}
    </div>
  );
}
