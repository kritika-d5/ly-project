import { CONTENT_LABEL, TIER_LABEL, type ContentType, type CourtTier } from '../api';

/**
 * The attribution badge. This is not decoration — 2,388 of the corpus's 7,722
 * chunks are text the court reproduced rather than wrote, and a user who reads
 * a quoted statute as a holding has been misinformed about the law.
 */
export function ContentBadge({ type }: { type: ContentType }) {
  const label = CONTENT_LABEL[type];
  return (
    <span
      title={label.full}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${label.tone}`}
    >
      {label.short}
    </span>
  );
}

export function TierBadge({ tier }: { tier: CourtTier }) {
  const label = TIER_LABEL[tier];
  return (
    <span
      title={label.full}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${label.tone}`}
    >
      {label.short}
    </span>
  );
}

const POLARITY: Record<string, { label: string; tone: string; title: string }> = {
  pos: {
    label: 'relied on',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    title: 'Referred to approvingly. Note this means "relied on", not the technical "followed".',
  },
  neg: {
    label: 'disagreed',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    title: 'The citing court disagreed with or distinguished this case',
  },
  mixed: {
    label: 'mixed',
    tone: 'bg-amber-50 text-amber-800 border-amber-200',
    title: 'Agreed in part and disagreed in part — often the most interesting treatment',
  },
  neutral: {
    label: 'mentioned',
    tone: 'bg-stone-100 text-stone-600 border-stone-300',
    title: 'Referred to without endorsing or rejecting it',
  },
};

export function PolarityBadge({ polarity }: { polarity: string | null }) {
  if (!polarity || !POLARITY[polarity]) return null;
  const p = POLARITY[polarity];
  return (
    <span
      title={p.title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${p.tone}`}
    >
      {p.label}
    </span>
  );
}
