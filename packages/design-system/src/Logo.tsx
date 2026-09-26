import type { CSSProperties } from "react";

/**
 * The Quicksort Q mark, traced from the identity Figma file
 * (viewBox 0 0 113 106): dark disc + light lozenge counterform + dot.
 *
 * Variants:
 * - "light"  — Seasalt mark on dark surfaces (default for dark UIs)
 * - "dark"   — Ink mark on light surfaces
 * - "accent" — Ink mark with the Signal Lime dot (signature state)
 */
export function LogoMark({
  variant = "light",
  size = 28,
  style,
  title = "Quicksort",
}: {
  variant?: "light" | "dark" | "accent";
  size?: number;
  style?: CSSProperties;
  title?: string;
}) {
  const disc = variant === "dark" || variant === "accent" ? "#141414" : "#FAFAFA";
  const cut = variant === "dark" || variant === "accent" ? "#FAFAFA" : "#141414";
  const dot = variant === "accent" ? "#CCFF00" : disc;
  return (
    <svg
      viewBox="0 0 113 106"
      width={size}
      height={(size * 106) / 113}
      fill="none"
      role="img"
      aria-label={title}
      style={style}
    >
      <circle cx="51.2" cy="51.2" r="51.2" fill={disc} />
      <g transform="matrix(0.674 -0.739 0.739 0.674 40.08 59.05)">
        <rect width="33.55" height="68.30" rx="16.78" fill={cut} />
      </g>
      <circle cx="90.22" cy="81.69" r="17.28" fill={dot} />
    </svg>
  );
}

/** Mark + "Quicksort" wordmark lockup, matching the Figma geometry. */
export function Logo({
  variant = "light",
  size = 28,
  wordmark = true,
  style,
}: {
  variant?: "light" | "dark" | "accent";
  size?: number;
  /** Render the wordmark text alongside the mark. */
  wordmark?: boolean;
  style?: CSSProperties;
}) {
  const mark = <LogoMark variant={variant} size={size} />;
  if (!wordmark) return mark;
  const ink = variant === "dark" || variant === "accent" ? "#141414" : "#FAFAFA";
  return (
    <span
      aria-label="Quicksort"
      role="img"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.32,
        ...style,
      }}
    >
      {mark}
      <span
        aria-hidden="true"
        style={{
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 500,
          fontSize: size * 0.82,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: ink,
        }}
      >
        Quicksort
      </span>
    </span>
  );
}
