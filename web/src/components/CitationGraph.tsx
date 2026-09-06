import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { CourtTier, GraphData, GraphLink, GraphNode } from '../api';

export type { GraphData, GraphLink, GraphNode };

/**
 * Edge colouring is deliberately lopsided.
 *
 * 274 of the 336 edges are `pos`, so colouring polarity naively produces an
 * almost uniformly one-colour picture in which nothing stands out. The rare
 * edges are the informative ones — Sushila Aggarwal treats Sibbia as `mixed`,
 * a Constitution Bench partly departing from an earlier Constitution Bench —
 * so approval is drawn as quiet grey and only disagreement gets colour.
 */
const LINK_STYLE: Record<string, { color: string; width: number }> = {
  pos: { color: 'rgba(148,163,184,0.5)', width: 1.1 },
  neutral: { color: 'rgba(148,163,184,0.35)', width: 1 },
  mixed: { color: '#ea580c', width: 2.6 },
  neg: { color: '#dc2626', width: 2.6 },
  none: { color: 'rgba(203,213,225,0.4)', width: 0.9 },
};

const linkStyle = (l: GraphLink) => LINK_STYLE[l.polarity ?? 'none'];

/** Fill carries the court, because which court decided a case changes what it
 *  is worth as authority. Role is carried by the ring and by position instead,
 *  so the two never compete for the same visual channel. */
const TIER_FILL: Record<CourtTier, string> = {
  SC: '#1e293b',
  HC: '#ffffff',
  OTHER: '#e2e8f0',
};

const ROLE_RING: Record<string, string> = {
  center: '#0f766e',
  authority: '#4338ca', // earlier cases this judgment cites
  citing: '#047857',    // later cases that cite it
};

/** Beyond this the nodes are bigger than the information they carry. */
const MAX_ZOOM = 1.8;

const idOf = (v: number | GraphNode) => (typeof v === 'number' ? v : v.id);

export default function CitationGraph({
  data,
  centerId,
  height = 460,
  onNodeClick,
  highlightDisagreement = false,
  labelMode = 'all',
  columns = false,
}: {
  data: GraphData;
  centerId?: number;
  height?: number;
  onNodeClick?: (node: GraphNode) => void;
  /** dim everything except edges the citing court did not simply follow */
  highlightDisagreement?: boolean;
  /**
   * 'all' suits a ~20-node ego graph. 'hubs' is for the full corpus, where
   * labelling 200 nodes at once produces unreadable overlapping text — there,
   * only well-cited cases are named until the user zooms or hovers.
   */
  labelMode?: 'all' | 'hubs';
  /**
   * Pin nodes into columns by `role`: authorities left, the focus case centre,
   * citing cases right. A free force layout scatters those three groups at
   * random, which hides the one thing an ego graph exists to show — which way
   * the citation runs. Only meaningful when nodes carry a role.
   */
  columns?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The force simulation writes x/y/vx/vy onto whatever objects it is given, so
  // hand it copies rather than letting it mutate the react-query cache.
  const graphData = useMemo(() => {
    const nodes = data.nodes.map((n) => ({ ...n }) as GraphNode & { fx?: number; fy?: number });

    if (columns) {
      // Pin BOTH axes rather than only x.
      //
      // Fixing x alone collapses each column: the link force pulls every
      // authority towards the centre node at its target distance (70), which is
      // far shorter than the 240 separating the columns, so the only way it can
      // shorten a link is to drag everything to the same y. The result is 18
      // nodes stacked on one another.
      //
      // Placing them explicitly also makes the layout deterministic and orders
      // each column by date, so the column reads chronologically instead of
      // however the simulation happened to settle.
      const ROW = 42;
      const place = (role: 'authority' | 'citing', x: number) => {
        const group = nodes
          .filter((n) => n.role === role)
          .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
        group.forEach((n, i) => {
          n.fx = x;
          n.fy = (i - (group.length - 1) / 2) * ROW;
        });
      };
      place('authority', -260);
      place('citing', 260);
      for (const n of nodes) {
        if (n.role === 'center') {
          n.fx = 0;
          n.fy = 0;
        }
      }
    }

    return { nodes, links: data.links.map((l) => ({ ...l })) };
  }, [data, columns]);

  // Which nodes and links touch the hovered node. Everything else fades, which
  // is the difference between looking at a web and reading one case's
  // citations.
  const connected = useMemo(() => {
    if (!hovered) return null;
    const links = new Set<GraphLink>();
    const nodes = new Set<number>([hovered.id]);
    for (const l of graphData.links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (s === hovered.id || t === hovered.id) {
        links.add(l);
        nodes.add(s);
        nodes.add(t);
      }
    }
    return { links, nodes };
  }, [hovered, graphData]);

  // Default forces pack a 200-node graph into a dense blob.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg?.d3Force) return;
    const big = graphData.nodes.length > 60;
    // In column mode every node's x is pinned, so all of the repulsion is
    // spent separating them vertically — which is exactly what a column of 18
    // authorities needs to stop being a stack of overlapping labels.
    const charge = columns ? -520 : big ? -260 : -170;
    fg.d3Force('charge')?.strength(charge);
    fg.d3Force('link')?.distance(big ? 55 : 70);
    fg.d3ReheatSimulation?.();
  }, [graphData, columns]);

  // Keep the layout in frame while it settles.
  //
  // A single fit is not enough: fitting early catches the nodes still bunched
  // near the origin and zooms far too far in, while onEngineStop did not fire
  // reliably here. Re-fitting on an interval for the first few seconds tracks
  // the layout as it expands and then stops.
  useEffect(() => {
    if (!width) return;
    const fit = () => {
      const fg = fgRef.current;
      if (!fg) return;
      fg.zoomToFit(300, 45);
      // A small ego graph would otherwise fill the canvas at 4-5x zoom, which
      // inflates every node and label.
      if (fg.zoom?.() > MAX_ZOOM) fg.zoom(MAX_ZOOM, 200);
    };
    const id = setInterval(fit, 500);
    const stop = setTimeout(() => clearInterval(id), 6000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [graphData, width]);

  const dimmedByFilter = (l: GraphLink) =>
    highlightDisagreement && l.polarity !== 'neg' && l.polarity !== 'mixed';
  const dimmedByHover = (l: GraphLink) => Boolean(connected) && !connected!.links.has(l);
  const linkDimmed = (l: GraphLink) => dimmedByFilter(l) || dimmedByHover(l);

  const radius = (n: GraphNode) =>
    n.id === centerId ? 10 : Math.min(11, 4.5 + Math.sqrt(n.degree) * 1.7);

  return (
    <div ref={wrapRef} className="relative rounded-lg border border-slate-200 bg-white">
      {width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={width}
          height={height}
          backgroundColor="#ffffff"
          nodeId="id"
          cooldownTicks={140}
          d3VelocityDecay={0.35}
          onEngineStop={() => fgRef.current?.zoomToFit(300, 45)}
          linkDirectionalArrowLength={5.5}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.06}
          linkColor={(l) =>
            linkDimmed(l as GraphLink) ? 'rgba(226,232,240,0.3)' : linkStyle(l as GraphLink).color
          }
          linkWidth={(l) => (linkDimmed(l as GraphLink) ? 0.6 : linkStyle(l as GraphLink).width)}
          onNodeClick={(n) => onNodeClick?.(n as GraphNode)}
          onNodeHover={(n) => setHovered((n as GraphNode) ?? null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode;
            const isCenter = n.id === centerId;
            const faded = Boolean(connected) && !connected!.nodes.has(n.id);
            const r = radius(n);

            ctx.globalAlpha = faded ? 0.18 : 1;

            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = isCenter ? ROLE_RING.center : TIER_FILL[n.courtTier];
            ctx.fill();

            // Ring = role relative to the focus case; fill = which court.
            const ring = n.role ? ROLE_RING[n.role] : undefined;
            ctx.lineWidth = (ring ? 2.2 : 1) / globalScale;
            ctx.strokeStyle = ring ?? (n.courtTier === 'SC' ? '#1e293b' : '#94a3b8');
            ctx.stroke();

            const showLabel =
              isCenter ||
              Boolean(connected?.nodes.has(n.id)) ||
              (labelMode === 'all' ? true : n.degree >= 8 || globalScale > 3);

            if (showLabel) {
              // Drawn in graph space and then multiplied by globalScale, so
              // dividing by it keeps labels at a constant on-screen size. Do
              // not add a floor here — it would scale with the zoom instead.
              const fontSize = (isCenter ? 12 : 11) / globalScale;
              ctx.font = `${isCenter ? 600 : 400} ${fontSize}px Inter, system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = isCenter ? '#0f766e' : '#475569';
              ctx.fillText(n.label, n.x!, n.y! + r + 3 / globalScale);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GraphNode;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, radius(n) + 4, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}

      {hovered && <NodeCard node={hovered} isCenter={hovered.id === centerId} />}
    </div>
  );
}

const TREATMENT_TEXT: Record<string, string> = {
  pos: 'relied on approvingly',
  neg: 'disagreed with or distinguished',
  mixed: 'agreed in part, disagreed in part',
  neutral: 'mentioned without endorsing',
};

function NodeCard({ node, isCenter }: { node: GraphNode; isCenter: boolean }) {
  const court =
    node.courtTier === 'SC'
      ? 'Supreme Court'
      : node.courtTier === 'HC'
        ? 'High Court'
        : 'Tribunal / other';

  const relation =
    node.role === 'authority'
      ? 'This judgment cites it'
      : node.role === 'citing'
        ? 'It cites this judgment'
        : null;

  return (
    <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border
                    border-slate-200 bg-white/95 px-3 py-2.5 shadow-md">
      <p className="text-[13px] font-medium leading-snug text-slate-800">{node.title}</p>

      <dl className="mt-2 space-y-1 text-[11px] text-slate-500">
        <Row label="Court">
          <span className={node.courtTier === 'SC' ? 'text-slate-700' : 'text-amber-700'}>
            {court}
            {node.courtTier === 'HC' && ' — persuasive, not binding'}
          </span>
        </Row>
        {node.year && <Row label="Decided">{node.year}</Row>}
        <Row label="Citations">{node.degree} in this corpus</Row>
        {relation && <Row label="Relation">{relation}</Row>}
        {node.treatment && TREATMENT_TEXT[node.treatment] && (
          <Row label="Treatment">
            <span
              className={
                node.treatment === 'mixed'
                  ? 'text-orange-700'
                  : node.treatment === 'neg'
                    ? 'text-red-700'
                    : 'text-slate-600'
              }
            >
              {TREATMENT_TEXT[node.treatment]}
            </span>
          </Row>
        )}
        <Row label="Full text">
          {node.hasPdf ? 'official PDF available' : 'text only, no official PDF'}
        </Row>
      </dl>

      {!isCenter && <p className="mt-2 text-[11px] text-slate-400">Click to open this case</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function GraphLegend({
  className = '',
  variant = 'corpus',
}: {
  className?: string;
  variant?: 'corpus' | 'ego';
}) {
  return (
    <div className={`space-y-2 text-[11px] text-slate-500 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-16 shrink-0 text-slate-400">Court</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-800" /> Supreme Court
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-slate-400 bg-white" /> High Court
        </span>
        <span className="text-slate-400">node size = citations in this corpus</span>
      </div>

      {variant === 'ego' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-16 shrink-0 text-slate-400">Direction</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-indigo-700 bg-white" />
            <span className="text-slate-600">left: this judgment cites it</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-700 bg-white" />
            <span className="text-slate-600">right: it cites this judgment</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-700" /> this case
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-16 shrink-0 text-slate-400">Treatment</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5" style={{ background: 'rgba(148,163,184,0.85)' }} /> relied on
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-5" style={{ background: '#ea580c' }} /> mixed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-5" style={{ background: '#dc2626' }} /> disagreed
        </span>
        <span className="text-slate-400">arrows point to the case being cited</span>
      </div>

      <p className="text-slate-400">Hover any node for details; the rest of the graph fades.</p>
    </div>
  );
}
