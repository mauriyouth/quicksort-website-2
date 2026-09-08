/**
 * The two marks the Quicksort design system actually ships.
 *
 * The identity is logo- and type-forward — the source Figma file contained
 * no icon set — so anywhere a UI would reach for a glyph, the system gives
 * you one of these instead. See the careers handoff in
 * quicksort-design-system/exports/design_handoff_careers_sections/.
 */

/** 45° up-right arrow, 11×11, stroked in currentColor. The system's only vector. */
export const ArrowGlyph = ({ className = "" }: { className?: string }): JSX.Element => (
  <svg
    className={`w-[11px] h-[11px] shrink-0 ${className}`}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden="true"
  >
    <path d="M3 9L9 3M9 3H4.2M9 3v4.8" />
  </svg>
);

/** The 5px Signal Lime dot — how the accent appears when it isn't a fill. */
export const SignalDot = (): JSX.Element => (
  <span className="w-[5px] h-[5px] shrink-0 rounded-qs-pill bg-signal" aria-hidden="true" />
);

/**
 * Section eyebrow: neutral text plus a lime dot.
 *
 * Deliberately *not* lime text — lime on a pale ground measures ~1.1:1 and
 * fails 4.5:1. The dot keeps the accent while the label stays legible in
 * both modes. Do not revert it to lime text.
 */
export const Eyebrow = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <p className="inline-flex items-center gap-2 font-qs-sans font-medium text-[11px] leading-none uppercase tracking-[0.14em] text-ink-muted">
    <SignalDot />
    {children}
  </p>
);

/** Neutral pill carrying one lime dot — department, category, status. */
export const SignalChip = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-[7px] py-1 pl-[9px] pr-[11px] rounded-qs-pill border border-line font-qs-sans font-medium text-[11px] leading-[1.4] tracking-[0.02em] text-ink-2 whitespace-nowrap">
    <SignalDot />
    {children}
  </span>
);
