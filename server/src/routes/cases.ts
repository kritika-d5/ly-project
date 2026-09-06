import { Router } from 'express';
import { Readable } from 'node:stream';
import { chunks, edges, nodes } from '../config.js';
import { caseChunks } from '../lib/caseContext.js';
import { deriveTier } from '../lib/search.js';

export const casesRouter = Router();

/** The public bucket the SCR PDFs live in. No credentials, no signing. */
const S3_BASE = 'https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com/';

/** GET /api/cases/:tid  everything the case page header needs. */
casesRouter.get('/cases/:tid', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const node = await nodes.findOne({ _id: tid }, { projection: { kanoon_html: 0, text: 0 } });
    if (!node) return res.status(404).json({ error: 'case not found' });

    const [outgoing, incoming, stats] = await Promise.all([
      edges.find({ src: tid }).toArray(),
      edges.find({ dst: tid }).toArray(),
      chunks.aggregate([
        { $match: { tid } },
        { $group: { _id: '$content_type', n: { $sum: 1 }, tokens: { $sum: '$token_count' } } },
      ]).toArray(),
    ]);

    // Resolve the other end of every edge to a title, so the UI can render
    // "cites Sanjay Chandra (2011)" rather than a bare tid.
    const otherTids = [...new Set([...outgoing.map((e) => e.dst), ...incoming.map((e) => e.src)])];
    const others = await nodes
      .find({ _id: { $in: otherTids } })
      .project({ title: 1, publishdate: 1, docsource: 1 })
      .toArray();
    const byId = new Map(others.map((n: any) => [n._id, n]));

    const shape = (e: any, otherId: number, direction: 'cites' | 'cited_by') => {
      const o: any = byId.get(otherId) ?? {};
      return {
        tid: otherId,
        title: o.title ?? String(otherId),
        year: Number(String(o.publishdate ?? '').slice(0, 4)) || null,
        courtTier: deriveTier(o.docsource),
        direction,
        // Populated by the data phase from Kanoon's citetext sentiment.
        // 'mixed' means the court agreed in part and disagreed in part:
        // signal, not noise, and the most doctrinally interesting category.
        polarity: e.polarity ?? null,
        polarityCounts: e.polarity_counts ?? null,
      };
    };

    res.json({
      tid,
      title: node.title,
      publishdate: node.publishdate ?? null,
      year: Number(String(node.publishdate ?? '').slice(0, 4)) || null,
      court: node.docsource ?? 'unknown',
      courtTier: deriveTier(node.docsource),
      author: node.author ?? null,
      neutralCitation: node.neutral_citation ?? null,
      layer: node.layer ?? null,
      duplicateOf: node.duplicate_of ?? null,
      // The PDF is the official SCR document. 58 of the 198 chunked cases have
      // none (every High Court case, everything pre-1950), so the UI must fall
      // back to the text view rather than showing a dead viewer.
      hasPdf: Boolean(node.s3_pdf_key),
      pdfUrl: node.s3_pdf_key ? `/api/cases/${tid}/pdf` : null,
      chunkStats: stats.map((s: any) => ({ contentType: s._id, chunks: s.n, tokens: s.tokens })),
      citations: {
        cites: outgoing.map((e) => shape(e, e.dst, 'cites')),
        citedBy: incoming.map((e) => shape(e, e.src, 'cited_by')),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cases/:tid/pdf  proxy the official SCR PDF.
 *
 * Proxied rather than linked directly because the bucket serves no CORS
 * header, so a browser-side pdf.js fetch against it is blocked. Streaming it
 * through here also means the 282 MB of PDFs never has to be stored locally.
 */
casesRouter.get('/cases/:tid/pdf', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const node = await nodes.findOne({ _id: tid }, { projection: { s3_pdf_key: 1 } });
    if (!node?.s3_pdf_key) {
      return res.status(404).json({ error: 'no official PDF for this case', tid });
    }
    const upstream = await fetch(S3_BASE + node.s3_pdf_key);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `S3 returned ${upstream.status}` });
    }
    res.setHeader('Content-Type', 'application/pdf');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cases/:tid/text  the reading fallback for cases with no PDF, and
 * the source of truth for what the chatbot actually sees. Returns chunks in
 * document order with their content_type labels intact.
 */
casesRouter.get('/cases/:tid/text', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const docs = await caseChunks(tid);
    if (!docs.length) return res.status(404).json({ error: 'no chunks for this case', tid });
    res.json({
      tid,
      title: docs[0].title,
      count: docs.length,
      chunks: docs.map((c) => ({
        id: c._id,
        seq: c.chunk_seq,
        text: c.text,
        locator: c.locator,
        contentType: c.content_type,
        chunkKind: c.chunk_kind,
        sectionPrimary: c.section_primary,
        tokens: c.token_count,
      })),
    });
  } catch (err) {
    next(err);
  }
});
