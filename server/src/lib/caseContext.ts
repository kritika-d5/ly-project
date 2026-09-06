/**
 * Case-scoped retrieval — the context for "chat with this judgment".
 *
 * This deliberately does NOT use Atlas $vectorSearch. `chunks_vector_index`
 * declares filter fields court_tier / content_type / chunk_kind / year /
 * layer / section_primary, but NOT `tid`, so it cannot pre-filter to a single
 * case. Rather than rebuild the index, we pull that one case's chunks and
 * cosine them in memory: the largest judgment in the corpus (A.K. Gopalan) has
 * 428 chunks and the median has 18, so this is a few hundred dot products over
 * 768 floats — sub-millisecond, and it keeps the Atlas index doing only the
 * cross-corpus job it was built for.
 */
import { chunks } from '../config.js';
import type { ChunkDoc, Passage } from '../types.js';
import { cosine, embedQuery } from './embed.js';

/** Chunks of one case, in document order, without their vectors. */
export async function caseChunks(tid: number): Promise<ChunkDoc[]> {
  return chunks
    .find({ tid })
    .project<ChunkDoc>({ embedding: 0 })
    .sort({ chunk_seq: 1 })
    .toArray();
}

/**
 * The most relevant passages inside a single judgment.
 *
 * Unlike corpus search, quoted material is NOT excluded here. If a user is
 * reading Antil and asks "what does Section 41 require?", the honest answer
 * lives in a `quoted_statute` chunk. The safeguard is not hiding it — it is
 * labelling it, so the answer says "the judgment reproduces Section 41 CrPC"
 * rather than "the Supreme Court held".
 */
export async function retrieveInCase(
  tid: number,
  query: string,
  k = 8,
): Promise<Passage[]> {
  const [queryVector, docs] = await Promise.all([
    embedQuery(query),
    chunks.find({ tid }).toArray(),
  ]);

  return docs
    .map((d) => ({
      id: d._id,
      tid: d.tid,
      text: d.text,
      locator: d.locator ?? null,
      contentType: d.content_type,
      sectionPrimary: d.section_primary,
      chunkKind: d.chunk_kind,
      score: d.embedding ? cosine(queryVector, d.embedding) : -1,
      via: ['vector' as const],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
