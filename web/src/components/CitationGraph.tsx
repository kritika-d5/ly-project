import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  pos: { color: 'rgba(178,151,127,0.55)', width: 1.1 },
  neutral: { color: 'rgba(178,151,127,0.38)', width: 1 },
  mixed: { color: '#c4923d', width: 2.6 },
  neg: { color: '#d9272f', width: 2.6 },
  none: { color: 'rgba(212,188,168,0.45)', width: 0.9 },
};

const DIM_LINK = 'rgba(230,213,198,0.35)';

const linkStyle = (l: GraphLink) => LINK_STYLE[l.polarity ?? 'none'];

/** Fill carries the court, because which court decided a case changes what it
 *  is worth as authority. Role is carried by the ring and by position instead,
 *  so the two never compete for the same visual channel. */
const TIER_FILL: Record<CourtTier, string> = {
  SC: '#3b2c26',
  HC: '#ffffff',
  OTHER: '#e6d5c6',
};

const ROLE_RING: Record<string, string> = {
  center: '#7a1f1c',
  authority: '#3e6e9b', // earlier cases this judgment cites
  citing: '#6d8a5c',    // later cases that cite it
};

/** Held-in-place and picked-out markers, drawn outside the role ring so the
 *  three states can all be true at once without overwriting each other. */
const PIN_RING = '#c4923d';
const SELECT_RING = '#7a1f1c';

/** Beyond this the nodes are bigger than the information they carry. */
const MAX_ZOOM = 1.8;
const MIN_ZOOM = 0.15;

/** Two clicks on the same node inside this window open the case. */
const DOUBLE_CLICK_MS = 350;

const idOf = (v: number | GraphNode) => (typeof v === 'number' ? v : v.id);

type PositionedNode = GraphNode & { fx?: number; fy?: number };

export default function CitationGraph({
  data,
  centerId,
  height = 460,
  onNodeOpen,
  highlightDisagreement = false,
  labelMode = 'all',
  columns = false,
  spotlight = null,
}: {
  data: GraphData;
  centerId?: number;
  height?: number;
  /**
   * Called when the user asks to leave for this case — the card's button, or a
   * double-click. A single click only selects: on a 200-node canvas, losing
   * the page you are reading is a harsh penalty for a misplaced click.
   */
  onNodeOpen?: (node: GraphNode) => void;
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
  /** Ids to pick out of the crowd; everything else fades. Null means no filter. */
  spotlight?: Set<number> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [pinned, setPinned] = useState<Set<number>>(() => new Set());

  /**
   * Auto-fitting is a courtesy for the first couple of seconds only. The moment
   * the user touches the canvas the camera is theirs, or a scheduled fit yanks
   * the view back while they are reading it. Listening for real pointer and
   * wheel events — rather than the graph's own zoom callback — keeps our own
   * programmatic camera moves from counting as user input.
   */
  const userMovedRef = useRef(false);
  const lastClickRef = useRef<{ id: number; t: number } | null>(null);

  /** Bumping this rebuilds the node objects from scratch, which is how
   *  "Reset" drops every pin the user has placed. */
  const [layoutKey, setLayoutKey] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const mark = () => {
      userMovedRef.current = true;
    };
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('pointerdown', mark);
    return () => {
      el.removeEventListener('wheel', mark);
      el.removeEventListener('pointerdown', mark);
    };
  }, []);

  // The force simulation writes x/y/vx/vy onto whatever objects it is given, so
  // hand it copies rather than letting it mutate the react-query cache.
  const graphData = useMemo(() => {
    const nodes = data.nodes.map((n) => ({ ...n }) as PositionedNode);

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
    // layoutKey is a deliberate reset handle, not a value read in the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, columns, layoutKey]);

  // Which nodes and links touch the node under attention. Everything else
  // fades, which is the difference between looking at a web and reading one
  // case's citations. Hover previews; a selection holds when the pointer
  // leaves, so the card can be read without keeping the mouse still.
  const focus = hovered ?? selected;
  const connected = useMemo(() => {
    if (!focus) return null;
    const links = new Set<GraphLink>();
    const nodes = new Set<number>([focus.id]);
    for (const l of graphData.links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (s === focus.id || t === focus.id) {
        links.add(l);
        nodes.add(s);
        nodes.add(t);
      }
    }
    return { links, nodes };
  }, [focus, graphData]);

  // Default forces pack a 200-node graph into a dense blob.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg?.d3Force) return;
    const dense = graphData.nodes.length > 60;
    // In column mode every node's x is pinned, so all of the repulsion is
    // spent separating them vertically — which is exactly what a column of 18
    // authorities needs to stop being a stack of overlapping labels.
    const charge = columns ? -520 : dense ? -260 : -170;
    fg.d3Force('charge')?.strength(charge);
    fg.d3Force('link')?.distance(dense ? 55 : 70);
    fg.d3ReheatSimulation?.();
  }, [graphData, columns]);

  /**
   * Fit the camera to the nodes.
   *
   * This replaces `zoomToFit` followed by a separate clamp back to MAX_ZOOM.
   * Those were two independent animations of the same camera: the fit zoomed in
   * past the cap and recentred, the clamp then zoomed back out about the
   * viewport centre, and on the next tick the fit recentred again. Run every
   * 500ms for six seconds, that ping-pong was the drift — the graph slid around
   * the canvas after load and never quite came to rest. Computing the centre
   * and the already-clamped zoom together means there is only ever one move.
   */
  const fitToNodes = useCallback(
    (ms = 350) => {
      const fg = fgRef.current;
      if (!fg || !width) return;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let seen = 0;
      for (const n of graphData.nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        seen++;
        if (n.x! < minX) minX = n.x!;
        if (n.x! > maxX) maxX = n.x!;
        if (n.y! < minY) minY = n.y!;
        if (n.y! > maxY) maxY = n.y!;
      }
      if (!seen) return;

      const PAD = 70;
      const k = Math.min(
        width / Math.max(maxX - minX + PAD * 2, 1),
        height / Math.max(maxY - minY + PAD * 2, 1),
        MAX_ZOOM,
      );
      fg.centerAt((minX + maxX) / 2, (minY + maxY) / 2, ms);
      fg.zoom(Math.max(k, MIN_ZOOM), ms);
    },
    [graphData, width, height],
  );

  // Track the layout while it spreads out, then leave it alone. Four scheduled
  // fits are enough to follow it out of the initial huddle.
  useEffect(() => {
    if (!width) return;
    userMovedRef.current = false;
    const schedule = [0, 400, 1200];
    const timers = schedule.map((delay) =>
      setTimeout(() => {
        if (!userMovedRef.current) fitToNodes(delay === 0 ? 0 : 350);
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [fitToNodes, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleNodeClick = (node: GraphNode) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === node.id && now - last.t < DOUBLE_CLICK_MS) {
      lastClickRef.current = null;
      onNodeOpen?.(node);
      return;
    }
    lastClickRef.current = { id: node.id, t: now };
    setSelected(node);
  };

  /**
   * Hold a dragged node where it was dropped.
   *
   * react-force-graph clears fx/fy when the drag ends, so the simulation
   * immediately pulls the node back into the pile — which is exactly the
   * "it gets mixed up with the rest of the bunch" problem. Writing the final
   * position back as a fixed one keeps it there until the user releases it.
   */
  const handleNodeDragEnd = (node: GraphNode) => {
    const n = node as PositionedNode;
    n.fx = n.x;
    n.fy = n.y;
    setPinned((prev) => new Set(prev).add(n.id));
  };

  const unpin = (id: number) => {
    // In column mode fx/fy are the layout itself, not a user pin, so releasing
    // a node there would drop it out of its column. Reset is the way back.
    if (!columns) {
      const n = graphData.nodes.find((x) => x.id === id) as PositionedNode | undefined;
      if (n) {
        n.fx = undefined;
        n.fy = undefined;
      }
    }
    setPinned((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    fgRef.current?.d3ReheatSimulation?.();
  };

  const resetLayout = () => {
    setPinned(new Set());
    setSelected(null);
    setLayoutKey((k) => k + 1);
    userMovedRef.current = false;
  };

  const nudgeZoom = (factor: number) => {
    const fg = fgRef.current;
    if (!fg?.zoom) return;
    fg.zoom(Math.min(MAX_ZOOM * 4, Math.max(MIN_ZOOM, fg.zoom() * factor)), 200);
  };

  const dimmedByFilter = (l: GraphLink) =>
    highlightDisagreement && l.polarity !== 'neg' && l.polarity !== 'mixed';
  const dimmedByHover = (l: GraphLink) => Boolean(connected) && !connected!.links.has(l);
  // A spotlight is a "find it in the crowd" tool, so the edges step back
  // wholesale rather than the code guessing which of them the user meant.
  const linkDimmed = (l: GraphLink) => Boolean(spotlight) || dimmedByFilter(l) || dimmedByHover(l);

  const radius = (n: GraphNode) =>
    n.id === centerId ? 10 : Math.min(11, 4.5 + Math.sqrt(n.degree) * 1.7);

  const card = selected ?? hovered;

  /**
   * Run most of the simulation before the first paint.
   *
   * Without a warmup the 200-node corpus graph arrives as a tight huddle and
   * spends the next ten to fifteen seconds visibly writhing apart, which is
   * the half of the "drift" that is the layout rather than the camera. Ticking
   * it forward off-screen costs a couple of hundred milliseconds once and the
   * graph appears already spread out, so the remaining cooldown is a settle
   * rather than a performance. Column mode places every node explicitly, so it
   * has nothing to warm up.
   */
  const big = graphData.nodes.length > 60;
  const warmupTicks = columns ? 0 : big ? 140 : 60;

  return (
    <div ref={wrapRef} className="relative rounded-lg border border-stone-200 bg-white">
      {width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={width}
          height={height}
          backgroundColor="#ffffff"
          nodeId="id"
          warmupTicks={warmupTicks}
          cooldownTicks={90}
          cooldownTime={5000}
          d3VelocityDecay={0.35}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM * 4}
          onEngineStop={() => {
            if (!userMovedRef.current) fitToNodes(350);
          }}
          onBackgroundClick={() => setSelected(null)}
          linkDirectionalArrowLength={5.5}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.06}
          linkColor={(l) => (linkDimmed(l as GraphLink) ? DIM_LINK : linkStyle(l as GraphLink).color)}
          linkWidth={(l) => (linkDimmed(l as GraphLink) ? 0.6 : linkStyle(l as GraphLink).width)}
          onNodeClick={(n) => handleNodeClick(n as GraphNode)}
          onNodeDragEnd={(n) => handleNodeDragEnd(n as GraphNode)}
          onNodeHover={(n) => setHovered((n as GraphNode) ?? null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode;
            const isCenter = n.id === centerId;
            const isSelected = selected?.id === n.id;
            const spotlit = !spotlight || spotlight.has(n.id);
            const faded = !spotlit || (Boolean(connected) && !connected!.nodes.has(n.id));
            const r = radius(n);

            ctx.globalAlpha = faded ? 0.15 : 1;

            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = isCenter ? ROLE_RING.center : TIER_FILL[n.courtTier];
            ctx.fill();

            // Ring = role relative to the focus case; fill = which court.
            const ring = n.role ? ROLE_RING[n.role] : undefined;
            ctx.lineWidth = (ring ? 2.2 : 1) / globalScale;
            ctx.strokeStyle = ring ?? (n.courtTier === 'SC' ? '#3b2c26' : '#b2977f');
            ctx.stroke();

            if (pinned.has(n.id)) {
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r + 3.5, 0, 2 * Math.PI);
              ctx.lineWidth = 1.6 / globalScale;
              ctx.strokeStyle = PIN_RING;
              ctx.stroke();
            }
            if (isSelected) {
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r + 7, 0, 2 * Math.PI);
              ctx.lineWidth = 1.8 / globalScale;
              ctx.strokeStyle = SELECT_RING;
              ctx.stroke();
            }

            const showLabel =
              isCenter ||
              isSelected ||
              (Boolean(spotlight) && spotlit) ||
              Boolean(connected?.nodes.has(n.id)) ||
              (labelMode === 'all' ? true : n.degree >= 8 || globalScale > 3);

            if (showLabel) {
              // Drawn in graph space and then multiplied by globalScale, so
              // dividing by it keeps labels at a constant on-screen size. Do
              // not add a floor here — it would scale with the zoom instead.
              const fontSize = (isCenter ? 12 : 11) / globalScale;
              const bold = isCenter || isSelected;
              ctx.font = `${bold ? 600 : 400} ${fontSize}px Inter, system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = bold ? '#7a1f1c' : '#55433a';
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

      {card && (
        <NodeCard
          node={card}
          isCenter={card.id === centerId}
          sticky={selected?.id === card.id}
          pinned={pinned.has(card.id)}
          onOpen={onNodeOpen ? () => onNodeOpen(card) : undefined}
          onUnpin={() => unpin(card.id)}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        {pinned.size > 0 && (
          <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-1 text-[11px] text-gold-700">
            {pinned.size} held
          </span>
        )}
        <CanvasButton onClick={() => nudgeZoom(1 / 1.4)} label="Zoom out">
          &minus;
        </CanvasButton>
        <CanvasButton onClick={() => nudgeZoom(1.4)} label="Zoom in">
          +
        </CanvasButton>
        <CanvasButton
          onClick={() => {
            userMovedRef.current = false;
            fitToNodes(350);
          }}
          label="Fit the whole graph in view"
        >
          Fit
        </CanvasButton>
        <CanvasButton onClick={resetLayout} label="Release every held node and re-run the layout">
          Reset
        </CanvasButton>
      </div>
    </div>
  );
}

function CanvasButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="min-w-7 rounded border border-stone-300 bg-white/90 px-2 py-1 text-[11px]
                 text-stone-600 shadow-sm hover:border-maroon-300 hover:text-maroon-700"
    >
      {children}
    </button>
  );
}

const TREATMENT_TEXT: Record<string, string> = {
  pos: 'relied on approvingly',
  neg: 'disagreed with or distinguished',
  mixed: 'agreed in part, disagreed in part',
  neutral: 'mentioned without endorsing',
};

function NodeCard({
  node,
  isCenter,
  sticky,
  pinned,
  onOpen,
  onUnpin,
  onClose,
}: {
  node: GraphNode;
  isCenter: boolean;
  sticky: boolean;
  pinned: boolean;
  onOpen?: () => void;
  onUnpin: () => void;
  onClose: () => void;
}) {
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
    <div
      className={`absolute left-3 top-3 max-w-xs rounded-lg border bg-white/95 px-3 py-2.5 shadow-md ${
        sticky ? 'pointer-events-auto border-maroon-200' : 'pointer-events-none border-stone-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <p className="text-[13px] font-medium leading-snug text-stone-800">{node.title}</p>
        {sticky && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mt-0.5 shrink-0 text-stone-400 hover:text-maroon-700"
          >
            &times;
          </button>
        )}
      </div>

      <dl className="mt-2 space-y-1 text-[11px] text-stone-500">
        <Row label="Court">
          <span className={node.courtTier === 'SC' ? 'text-stone-700' : 'text-terracotta-600'}>
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
                  ? 'text-gold-600'
                  : node.treatment === 'neg'
                    ? 'text-vermilion-600'
                    : 'text-stone-600'
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

      {sticky ? (
        <div className="mt-2.5 flex items-center gap-2">
          {!isCenter && onOpen && (
            <button
              onClick={onOpen}
              className="rounded bg-maroon-800 px-2.5 py-1 text-[11px] font-medium text-white
                         hover:bg-maroon-700"
            >
              Open case &rarr;
            </button>
          )}
          {pinned && (
            <button
              onClick={onUnpin}
              className="rounded border border-gold-300 bg-gold-50 px-2 py-1 text-[11px] text-gold-700
                         hover:border-gold-500"
            >
              Release
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-stone-400">Click to keep this open</p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-stone-400">{label}</dt>
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
    <div className={`space-y-2 text-[11px] text-stone-500 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-16 shrink-0 text-stone-400">Court</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-800" /> Supreme Court
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-stone-400 bg-white" /> High Court
        </span>
        <span className="text-stone-400">node size = citations in this corpus</span>
      </div>

      {variant === 'ego' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-16 shrink-0 text-stone-400">Direction</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-navy-500 bg-white" />
            <span className="text-stone-600">left: this judgment cites it</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-sage-600 bg-white" />
            <span className="text-stone-600">right: it cites this judgment</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-maroon-700" /> this case
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-16 shrink-0 text-stone-400">Treatment</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5" style={{ background: 'rgba(140,115,97,0.85)' }} /> relied on
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-5" style={{ background: '#c4923d' }} /> mixed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-5" style={{ background: '#d9272f' }} /> disagreed
        </span>
        <span className="text-stone-400">arrows point to the case being cited</span>
      </div>

      <p className="text-stone-400">
        Hover previews a node and fades the rest &middot; click keeps the card open &middot;
        <span className="text-gold-700"> drag holds a node in place</span> &middot; double-click
        opens the case &middot; Reset releases everything.
      </p>
    </div>
  );
}
