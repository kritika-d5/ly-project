import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEgoGraph, type GraphNode } from '../api';
import CitationGraph, { GraphLegend } from './CitationGraph';

/**
 * One case's citation neighbourhood.
 *
 * Depth 1 by default. The median case has degree 2 and the busiest has 25, so
 * the second ring is where a picture stops being a reading aid and becomes
 * decoration — it stays available, just not the default.
 */
export default function EgoGraph({ tid }: { tid: number }) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const [onlyDisagreement, setOnlyDisagreement] = useState(false);
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['ego', tid, depth],
    queryFn: () => getEgoGraph(tid, depth),
  });

  /**
   * Label every node by its direction relative to this case, and by how this
   * case treated it. The API deliberately doesn't do this — direction only
   * means something once you have picked a case to stand in the middle of.
   *
   * An edge runs src -> dst meaning "src cites dst". So an edge leaving this
   * case points at an authority it relied on (earlier), and an edge arriving
   * points from a later case that cited it.
   */
  const annotated = useMemo(() => {
    if (!data) return null;
    const idOf = (v: number | GraphNode) => (typeof v === 'number' ? v : v.id);
    const role = new Map<number, 'authority' | 'citing'>();
    const treatment = new Map<number, 'pos' | 'neg' | 'neutral' | 'mixed' | null>();

    for (const l of data.links) {
      const src = idOf(l.source);
      const dst = idOf(l.target);
      if (src === tid) {
        role.set(dst, 'authority');
        treatment.set(dst, l.polarity);
      } else if (dst === tid) {
        if (!role.has(src)) role.set(src, 'citing');
        treatment.set(src, l.polarity);
      }
    }

    return {
      nodes: data.nodes.map((n) => ({
        ...n,
        role: n.id === tid ? ('center' as const) : role.get(n.id),
        treatment: treatment.get(n.id) ?? null,
      })),
      links: data.links,
    };
  }, [data, tid]);

  if (isLoading) return <p className="text-sm text-stone-500">Building the citation graph&hellip;</p>;
  if (error) return <p className="text-sm text-vermilion-700">{(error as Error).message}</p>;
  if (!annotated || !data) return null;

  const cites = annotated.nodes.filter((n) => n.role === 'authority').length;
  const citedBy = annotated.nodes.filter((n) => n.role === 'citing').length;
  const interesting = data.links.filter(
    (l) => l.polarity === 'neg' || l.polarity === 'mixed',
  ).length;

  // Give the taller column room. Antil cites 18 cases; packed into a fixed
  // 480px canvas those nodes and their labels sit on top of each other.
  const graphHeight =
    depth === 2
      ? 560
      : Math.min(820, Math.max(420, 90 + Math.max(cites, citedBy) * 34));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-stone-500">
          <span className="text-navy-500">{cites} cases it cites</span>
          {' · '}
          <span className="text-sage-600">{citedBy} that cite it</span>
          {interesting > 0 && (
            <>
              {' · '}
              <span className="text-gold-600">
                {interesting} not simply followed
              </span>
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-stone-600">
            <input
              type="checkbox"
              checked={onlyDisagreement}
              onChange={(e) => setOnlyDisagreement(e.target.checked)}
              className="accent-maroon-700"
              disabled={interesting === 0}
            />
            Only disagreement
          </label>
          <div className="flex overflow-hidden rounded border border-stone-300">
            {([1, 2] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`px-2 py-1 ${
                  depth === d ? 'bg-maroon-800 text-white' : 'bg-white text-stone-600'
                }`}
              >
                {d === 1 ? 'Direct' : 'Two hops'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <CitationGraph
        data={annotated}
        centerId={tid}
        height={graphHeight}
        columns={depth === 1}
        highlightDisagreement={onlyDisagreement}
        onNodeOpen={(n) => {
          if (n.id !== tid) navigate(`/case/${n.id}`);
        }}
      />

      <GraphLegend className="mt-3" variant="ego" />

      <p className="mt-3 text-[11px] text-stone-400">
        Citation treatment is derived from Indian Kanoon&rsquo;s own annotations and has not been
        reviewed by a lawyer. &ldquo;Relied on&rdquo; means the case was referred to approvingly,
        not the technical &ldquo;followed&rdquo;.
      </p>
    </div>
  );
}
