/**
 * The empty-state illustration for the search page: a courtroom facade, a case
 * file, and the citation motif from the wordmark tying it back to what the app
 * actually does.
 *
 * Flat shapes, no gradients, palette classes rather than literal hex, so it
 * moves with the theme instead of drifting out of it. The elements are laid
 * out side by side rather than stacked on top of each other — it renders at
 * about 180px wide, and at that size overlapping shapes turn into mush.
 */
export default function CaseFileMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 280 180"
      className={className}
      role="img"
      aria-label="A courtroom facade beside a case file"
    >
      {/* Soft ground, so the objects sit on something rather than float. */}
      <path
        d="M16 146C6 92 56 28 132 26c78-2 138 42 132 92-4 30-48 40-112 38Z"
        className="fill-stone-100"
      />

      {/* Court facade, left. */}
      <path d="M34 66 78 42l44 24Z" className="fill-terracotta-300" />
      <g className="fill-terracotta-200">
        <rect x="47" y="72" width="7" height="30" rx="2" />
        <rect x="62" y="72" width="7" height="30" rx="2" />
        <rect x="77" y="72" width="7" height="30" rx="2" />
        <rect x="92" y="72" width="7" height="30" rx="2" />
      </g>
      <rect x="36" y="102" width="86" height="8" rx="4" className="fill-terracotta-400" />

      {/* Gavel, top right, clear of the file below it. */}
      <rect
        x="230"
        y="26"
        width="30"
        height="16"
        rx="4"
        transform="rotate(45 245 34)"
        className="fill-maroon-800"
      />
      <path
        d="M232 44 210 66"
        className="stroke-maroon-700"
        strokeWidth="7"
        strokeLinecap="round"
      />

      {/* Papers, fanned so the file reads as holding more than one judgment. */}
      <rect
        x="150"
        y="62"
        width="86"
        height="46"
        rx="4"
        transform="rotate(-5 193 85)"
        className="fill-stone-50 stroke-stone-300"
        strokeWidth="1.5"
      />
      <g
        className="stroke-stone-300"
        strokeWidth="2.5"
        strokeLinecap="round"
        transform="rotate(-5 193 85)"
      >
        <path d="M163 76h58M163 86h58M163 96h34" />
      </g>

      {/* The file itself, front right. */}
      <path
        d="M138 100h28l9-13h71a6 6 0 0 1 6 6v55a6 6 0 0 1-6 6H138a6 6 0 0 1-6-6v-42a6 6 0 0 1 6-6Z"
        className="fill-terracotta-400"
      />
      <path d="M132 120h120" className="stroke-terracotta-500" strokeWidth="2" />

      {/* Seal: the official-record cue, and the one spot of gold. */}
      <circle cx="222" cy="136" r="14" className="fill-gold-400" />
      <circle cx="222" cy="136" r="7" className="fill-maroon-700" />

      {/* The citation motif from the wordmark: two authorities into a hub. */}
      <g className="stroke-maroon-300" strokeWidth="2" strokeLinecap="round">
        <path d="M52 130 78 142M52 154 78 142" />
      </g>
      <circle cx="50" cy="130" r="5" className="fill-stone-300" />
      <circle cx="50" cy="154" r="5" className="fill-stone-300" />
      <circle cx="80" cy="142" r="7.5" className="fill-maroon-700" />
    </svg>
  );
}
