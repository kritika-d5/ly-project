/**
 * Shapes of the existing Mongo documents. These mirror the collections built
 * by the chunking phase (see CHUNKING.md §3 in the LegalRAG-Data repo) — they
 * describe data that already exists, they do not define it.
 */

/** Who is speaking in a chunk. The single most important field in the corpus:
 *  only `court_text` is the court's own words. Presenting `quoted_statute` or
 *  `quoted_case` as a holding is the exact failure the chunking phase exists
 *  to prevent, so this label must survive all the way to the UI. */
export type ContentType =
  | 'court_text'      // the court speaking
  | 'quoted_case'     // another judgment, quoted
  | 'quoted_statute'  // bare provision text
  | 'quoted_other'    // dictionary, foreign court, speech
  | 'editorial';      // SCR headnote — editors, not the court

/** In Indian law a High Court decision does not bind the way a Supreme Court
 *  one does. 1,004 of the 7,722 chunks are High Court. */
export type CourtTier = 'SC' | 'HC' | 'OTHER';

export interface NodeDoc {
  _id: number;
  title: string;
  publishdate?: string;
  docsource?: string;
  bench?: unknown;
  author?: string;
  neutral_citation?: string | null;
  layer?: 'seed' | 'core' | 'periphery' | 'external';
  matched?: boolean;
  s3_pdf_key?: string | null;
  text?: string;
  kanoon_html?: string;
  duplicate_of?: number;
}

export interface EdgeDoc {
  _id?: unknown;
  src: number;
  dst: number;
  via?: 'cite' | 'citedby';
  polarity?: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarity_counts?: { pos: number; neg: number; neutral: number };
}

export interface ChunkDoc {
  _id: string;
  tid: number;
  chunk_seq: number;
  text: string;
  token_count: number;
  para_ids: string[];
  content_type: ContentType;
  section_types: string[];
  section_primary: string;
  chunk_kind: 'body' | 'headnote';
  para_start: number | null;
  para_end: number | null;
  scr_page_start: number | null;
  locator: string | null;
  title: string;
  publishdate: string;
  year: number;
  court: string;
  court_tier: CourtTier;
  layer: string;
  embedding?: number[];
  embedding_model?: string;
}

/** A single citetext span recorded on a paragraph. `PARTY` was excluded from
 *  `edges.polarity` by the data phase (it means "a litigant's counsel cited
 *  this", not "the court treated it this way") but is exactly the signal
 *  Counter Engine's v0 fallback and R3 graph-attack round need. */
export interface ParagraphCitation {
  docid: number;
  sentiment: 'Pos' | 'Neg' | 'Neutral' | 'PARTY' | string;
}

/** The finer-grained intermediate `chunks` was built from (CHUNKING.md §3.1).
 *  Carries two fields no `chunks` doc has: `kanoon_structure` (PetArg /
 *  RespArg / ...) and the raw per-paragraph `citations` array. */
export interface ParagraphDoc {
  _id: string;
  tid: number;
  seq: number;
  text: string;
  content_type: ContentType | 'appearance' | 'front_matter';
  kanoon_structure: string | null;
  section_type: string;
  locator: string | null;
  citations: ParagraphCitation[];
  keep: boolean;
}

/** A chunk plus its retrieval provenance, as returned to the client. */
export interface Passage {
  id: string;
  tid: number;
  text: string;
  locator: string | null;
  contentType: ContentType;
  sectionPrimary: string;
  chunkKind: 'body' | 'headnote';
  score: number;
  /** which retriever(s) found it — useful for debugging relevance */
  via: ('vector' | 'text')[];
}

/* ------------------------------------------------------------------------ *
 * Counter Engine (CounterEngine.md §3/§4). v0: the `arguments` collection
 * does not exist yet (ARGUMENTS.md Stages B/C are unbuilt), so `stance` and
 * `outcome` are always absent here — never fabricate them. §11's v0 fallback
 * substitutes a vector search on `chunks` (section_primary: 'submissions')
 * joined to `paragraphs` for `kanoon_structure`, labelled "side not yet
 * determined" rather than a real stance.
 * ------------------------------------------------------------------------ */

export type OffenceCategory =
  | 'ordinary' | 'economic' | 'ndps' | 'pmla' | 'uapa' | 'other_special';

export type Side = 'pro_bail' | 'anti_bail';

export interface CounterRequest {
  position: string;
  side: Side;
  offenceCategory?: OffenceCategory;
}

export interface Classification {
  inScope: boolean;
  topics: string[];
  offenceCategory: OffenceCategory;
  /** drives the "Detected: NDPS ✎" chip — false once the user edits it */
  offenceInferred: boolean;
  /** true when classify() fell back (no Groq key, or the LLM call itself
   *  errored) rather than actually verifying scope. The UI must show this,
   *  not silently present an unverified guess as a real classification. */
  classificationFailed: boolean;
}

export type Speaker = 'THE COURT' | 'COUNSEL' | 'STATUTE' | 'HEADNOTE';

/** Round 3's explanation for why an item surfaced when it was not a direct
 *  text match — GRAPH_RETRIEVAL.md's rule that an unexplained result is worse
 *  than a missing one. */
export interface BecauseOf {
  tid: number;
  title: string;
  polarity: 'neg' | 'mixed';
}

export interface CounterItem {
  id: string;
  kind: 'court_holding' | 'argument' | 'statute';

  text: string;

  speaker: Speaker;
  /** v0 never sets these — Stage B/C data does not exist yet */
  stance?: Side;
  outcome?: 'accepted' | 'rejected' | 'not_addressed' | 'unclear';
  /** v0's honest substitute for `stance` on submissions items */
  stanceUndetermined?: boolean;

  tid: number;
  caseTitle: string;
  year: number;
  courtTier: CourtTier;
  locator: string | null;
  paraIds: string[];

  authorities?: { tid: number; title: string }[];

  viaGraph?: boolean;
  becauseOf?: BecauseOf[];
  /** Round 4 (rebuttals) — never populated in v0, needs ARGUMENTS.md Stage C.
   *  Declared now so the client's nested-response rendering does not need to
   *  change shape when that round is built. */
  responses?: CounterResponseItem[];
}

export interface CounterResponseItem {
  kind: 'argument_failed' | 'authority_doubted';
  text: string;
  tid: number;
  caseTitle: string;
  locator: string | null;
  polarity?: 'neg' | 'mixed';
}

export interface RoundResult {
  round: 'supporting' | 'opposing' | 'statutes';
  items: CounterItem[];
  empty: boolean;
}

export interface CounterResponseBody {
  classification: Classification;
  rounds: RoundResult[];
  /** Stage F (CounterEngine.md §6/§8.2) — the synthesised research summary,
   *  markdown, citing retrieved passages by their [N] number. Empty string
   *  when out of scope (the UI's out-of-scope state covers that) or when
   *  generation itself failed (`generationFailed: true` — show the rounds,
   *  say the summary could not be produced, never show blank as if nothing
   *  were wrong). */
  answer: string;
  generationFailed: boolean;
  /** Hard Rule 4 check: [N] numbers the model cited that were not in the
   *  supplied passage set. Non-empty means a hallucinated citation slipped
   *  through — surfaced, not silently hidden. */
  invalidCitations: number[];
  tookMs: number;
}
