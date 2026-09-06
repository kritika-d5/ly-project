/**
 * Typed client for the LegalPlatform API.
 *
 * `contentType` is threaded through every shape here on purpose. It is what
 * lets the UI say "this is the statute, not the holding" — the distinction the
 * whole corpus was built to preserve. Do not drop it when adding fields.
 */

export type ContentType =
  | 'court_text'
  | 'quoted_case'
  | 'quoted_statute'
  | 'quoted_other'
  | 'editorial';

export type CourtTier = 'SC' | 'HC' | 'OTHER';

export interface Passage {
  id: string;
  tid: number;
  text: string;
  locator: string | null;
  contentType: ContentType;
  sectionPrimary: string;
  chunkKind: 'body' | 'headnote';
  score: number;
  via: ('vector' | 'text')[];
}

export interface CaseResult {
  tid: number;
  title: string;
  year: number;
  court: string;
  courtTier: CourtTier;
  layer: string;
  hasPdf: boolean;
  score: number;
  citedByCount: number;
  passages: Passage[];
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  count: number;
  results: CaseResult[];
}

export interface Citation {
  tid: number;
  title: string;
  year: number | null;
  courtTier: CourtTier;
  direction: 'cites' | 'cited_by';
  polarity: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

export interface CaseDetail {
  tid: number;
  title: string;
  publishdate: string | null;
  year: number | null;
  court: string;
  courtTier: CourtTier;
  author: string | null;
  neutralCitation: string | null;
  layer: string | null;
  duplicateOf: number | null;
  hasPdf: boolean;
  pdfUrl: string | null;
  chunkStats: { contentType: ContentType; chunks: number; tokens: number }[];
  citations: { cites: Citation[]; citedBy: Citation[] };
}

export interface CaseText {
  tid: number;
  title: string;
  count: number;
  chunks: {
    id: string;
    seq: number;
    text: string;
    locator: string | null;
    contentType: ContentType;
    chunkKind: 'body' | 'headnote';
    sectionPrimary: string;
    tokens: number;
  }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface SearchParams {
  q: string;
  courtTier?: CourtTier | '';
  contentTypes?: ContentType[];
}

export function searchCases({ q, courtTier, contentTypes }: SearchParams) {
  const params = new URLSearchParams({ q, limit: '20' });
  if (courtTier) params.set('courtTier', courtTier);
  if (contentTypes?.length) params.set('contentTypes', contentTypes.join(','));
  return get<SearchResponse>(`/api/search?${params}`);
}

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
  /**
   * Position relative to the focus case in an ego graph. Set client-side, not
   * by the API: it only has meaning once you have chosen a case to centre on.
   * 'authority' = the focus case cites it; 'citing' = it cites the focus case.
   */
  role?: 'center' | 'authority' | 'citing';
  /** how the focus case treated it, for the hover card */
  treatment?: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  /** injected by the force simulation at render time */
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: number | GraphNode;
  target: number | GraphNode;
  polarity: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const getGraph = () => get<GraphData>('/api/graph');

export const getEgoGraph = (tid: number, depth: 1 | 2 = 1) =>
  get<GraphData & { center: number; depth: number }>(`/api/graph/ego/${tid}?depth=${depth}`);

export const getCase = (tid: number) => get<CaseDetail>(`/api/cases/${tid}`);
export const getCaseText = (tid: number) => get<CaseText>(`/api/cases/${tid}/text`);

export async function getSummary(tid: number) {
  const res = await fetch(`/api/cases/${tid}/summary`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `summary failed (${res.status})`);
  }
  return res.json() as Promise<{ tid: number; title: string; summary: string; passages: Passage[] }>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streams a case-scoped answer over SSE.
 *
 * `onSources` fires before any token, so the UI can show what the model was
 * given before it starts talking — evidence first, answer second.
 */
export async function streamChat(
  tid: number,
  message: string,
  history: ChatTurn[],
  handlers: {
    onSources: (passages: Passage[]) => void;
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const res = await fetch(`/api/cases/${tid}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    handlers.onError(body.error ?? `chat failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || dataLine === undefined) continue;
      const data = JSON.parse(dataLine);
      if (event === 'sources') handlers.onSources(data.passages);
      else if (event === 'token') handlers.onToken(data.text);
      else if (event === 'done') handlers.onDone();
      else if (event === 'error') handlers.onError(data.message);
    }
  }
  handlers.onDone();
}

/** How each content_type is described in the UI. The wording matters: a user
 *  must never read quoted material as the court's ruling. */
export const CONTENT_LABEL: Record<ContentType, { short: string; full: string; tone: string }> = {
  court_text: {
    short: "Court's words",
    full: "The court's own words in this judgment",
    tone: 'bg-sage-50 text-sage-700 border-sage-200',
  },
  editorial: {
    short: 'SCR headnote',
    full: 'A summary written by law reporters, not by the court',
    tone: 'bg-navy-50 text-navy-600 border-navy-200',
  },
  quoted_statute: {
    short: 'Statute text',
    full: 'The bare text of a statutory provision reproduced in the judgment',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
  },
  quoted_case: {
    short: 'Quoted judgment',
    full: 'Quoted from another judgment — not this court speaking',
    tone: 'bg-terracotta-100 text-terracotta-600 border-terracotta-200',
  },
  quoted_other: {
    short: 'Quoted source',
    full: 'Quoted from an outside source (dictionary, foreign court, report)',
    tone: 'bg-stone-100 text-stone-700 border-stone-300',
  },
};

export const TIER_LABEL: Record<CourtTier, { short: string; full: string; tone: string }> = {
  SC: {
    short: 'Supreme Court',
    full: 'Supreme Court of India — binding on all courts',
    tone: 'bg-stone-800 text-white border-stone-800',
  },
  HC: {
    short: 'High Court',
    full: 'High Court — persuasive, not binding the way a Supreme Court decision is',
    tone: 'bg-white text-stone-700 border-stone-400',
  },
  OTHER: {
    short: 'Tribunal / other',
    full: 'Not a Supreme Court or High Court decision',
    tone: 'bg-white text-stone-500 border-stone-300',
  },
};
