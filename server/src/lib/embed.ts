/**
 * BGE query embedding.
 *
 * The corpus was embedded in Python with sentence-transformers using
 * BAAI/bge-base-en-v1.5. This module must land in the SAME vector space or
 * every search result is noise. Verified 2026-09-06: the ONNX build below
 * reproduces the Python vectors at cosine 1.000000, max elementwise
 * difference 0.000000, on a real corpus chunk.
 *
 * Two things must not be changed casually:
 *
 *  1. POOLING IS 'cls', NOT 'mean'. BGE pools the [CLS] token. Mean pooling
 *     silently produces a different (wrong) vector — no error, just bad results.
 *
 *  2. QUERIES GET A PREFIX, PASSAGES DO NOT. BGE is asymmetric: it was trained
 *     expecting queries to be marked with an instruction. The stored chunks were
 *     embedded with no prefix, so only the query side adds one here.
 */
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/bge-base-en-v1.5'; // ONNX export of BAAI/bge-base-en-v1.5
export const EMBEDDING_MODEL = 'BAAI/bge-base-en-v1.5'; // what the chunks carry
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    // fp32, not quantised: the parity above was measured at full precision and
    // there is no throughput reason to trade accuracy here — we embed one short
    // query per request, not a corpus.
    extractorPromise = pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
  }
  return extractorPromise;
}

/** Load the model ahead of the first request so users don't pay the ~5s cost. */
export async function warmUp(): Promise<void> {
  const t0 = Date.now();
  await embedQuery('warm up');
  console.log(`[embed] ${MODEL} ready in ${Date.now() - t0}ms`);
}

/** Embed a user's search query. Adds the BGE instruction prefix. */
export async function embedQuery(query: string): Promise<number[]> {
  return embedRaw(QUERY_PREFIX + query);
}

/** Embed text exactly as stored — no prefix. Only for comparing against
 *  existing chunk vectors on equal terms. */
export async function embedPassage(text: string): Promise<number[]> {
  return embedRaw(text);
}

async function embedRaw(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'cls', normalize: true });
  return Array.from(out.data as Float32Array);
}

/** Cosine similarity of two L2-normalised vectors — i.e. just the dot product.
 *  Both sides here are normalised (BGE `normalize: true`, and the stored
 *  vectors were written with normalize_embeddings=True). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
