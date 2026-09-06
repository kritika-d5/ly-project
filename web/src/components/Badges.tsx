import { CONTENT_LABEL, TIER_LABEL, type ContentType, type CourtTier } from '../api';
import Icon from './Icon';

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
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${label.tone}`}
    >
      <Icon name="court" size={11} strokeWidth={1.8} />
      {label.short}
    </span>
  );
}

const POLARITY: Record<string, { label: string; tone: string; title: string }> = {
  pos: {
    label: 'relied on',
    tone: 'bg-sage-50 text-sage-700 border-sage-200',
    title: 'Referred to approvingly. Note this means "relied on", not the technical "followed".',
  },
  neg: {
    label: 'disagreed',
    tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200',
    title: 'The citing court disagreed with or distinguished this case',
  },
  mixed: {
    label: 'mixed',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
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
