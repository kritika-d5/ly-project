import { Router } from 'express';
import { z } from 'zod';
import { edges, nodes } from '../config.js';
import { deriveTier } from '../lib/search.js';
import type { CourtTier, EdgeDoc, NodeDoc } from '../types.js';

export const graphRouter = Router();

export interface GraphNode {
  id: number;
  title: string;
  /** short label for drawing — the full title is far too long for a node */
  label: string;
  year: number | null;
  courtTier: CourtTier;
  layer: string | null;
  degree: number;
  hasPdf: boolean;
}

export interface GraphLink {
  source: number;
  target: number;
  polarity: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

/**
 * Judgment titles are formatted "X vs Y on 9 April, 1980" — unusable as a node
 * label. Take the first party, trim the boilerplate, and cap the length.
 */
function shortLabel(title: string): string {
  const withoutDate = title.replace(/\s+on\s+\d{1,2}\s+\w+,\s*\d{4}\s*$/i, '');
  const firstParty = withoutDate.split(/\s+vs?\.?\s+/i)[0].trim();
  const cleaned = firstParty.replace(/\s+(etc\.?|and ors\.?|& anr\.?|& ors\.?)$/i, '').trim();
  const pick = cleaned.length >= 3 ? cleaned : withoutDate;
  return pick.length > 28 ? `${pick.slice(0, 27)}…` : pick;
}

function toGraphNode(n: Partial<NodeDoc> & { _id: number }, degree: number): GraphNode {
  const title = n.title ?? String(n._id);
  return {
    id: n._id,
    title,
    label: shortLabel(title),
    year: Number(String(n.publishdate ?? '').slice(0, 4)) || null,
    courtTier: deriveTier(n.docsource),
    layer: n.layer ?? null,
    degree,
    hasPdf: Boolean(n.s3_pdf_key),
  };
}

function toGraphLink(e: EdgeDoc): GraphLink {
  return {
    source: e.src,
    target: e.dst,
    polarity: e.polarity ?? null,
    polarityCounts: e.polarity_counts ?? null,
  };
}

async function buildGraph(edgeDocs: EdgeDoc[], extraTids: number[] = []) {
  const tids = [...new Set([...extraTids, ...edgeDocs.flatMap((e) => [e.src, e.dst])])];
  const degree = new Map<number, number>();
  for (const e of edgeDocs) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  const docs = await nodes
    .find({ _id: { $in: tids } })
    .project<Partial<NodeDoc> & { _id: number }>({
      title: 1, publishdate: 1, docsource: 1, layer: 1, s3_pdf_key: 1,
    })
    .toArray();

  return {
    nodes: docs.map((d) => toGraphNode(d, degree.get(d._id) ?? 0)),
    links: edgeDocs.map(toGraphLink),
  };
}

/**
 * GET /api/graph/ego/:tid  one case and its immediate citation neighbourhood.
 *
 * `depth=2` also pulls the neighbours' own edges, which turns a star into
 * something with actual structure. Kept off by default: the median case has
 * degree 2, but the busiest (Siddharam Mhetre) has 25, and its second ring runs
 * to well over a hundred nodes — legible as a picture, useless as a reading aid.
 */
graphRouter.get('/graph/ego/:tid', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const depth = z.coerce.number().int().min(1).max(2).catch(1).parse(req.query.depth);

    const firstRing = await edges.find({ $or: [{ src: tid }, { dst: tid }] }).toArray();
    const neighbourIds = [...new Set(firstRing.flatMap((e) => [e.src, e.dst]))]
      .filter((id) => id !== tid);

    let edgeDocs = firstRing;
    if (depth === 2 && neighbourIds.length) {
      const secondRing = await edges
        .find({ $or: [{ src: { $in: neighbourIds } }, { dst: { $in: neighbourIds } }] })
        .toArray();
      // Deduplicate: an edge can appear in both rings.
      const seen = new Set(firstRing.map((e) => `${e.src}->${e.dst}`));
      edgeDocs = [
        ...firstRing,
        ...secondRing.filter((e) => !seen.has(`${e.src}->${e.dst}`)),
      ];
    }

    const graph = await buildGraph(edgeDocs, [tid]);
    res.json({ center: tid, depth, ...graph });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/graph  the whole citation graph: 198 judgments, 336 edges.
 *
 * Small enough to send in one response (a few hundred KB) and to lay out in
 * the browser, so there is no pagination or server-side layout here.
 */
graphRouter.get('/graph', async (_req, res, next) => {
  try {
    const edgeDocs = await edges.find({}).toArray();
    const graph = await buildGraph(edgeDocs);
    res.json(graph);
  } catch (err) {
    next(err);
  }
});
