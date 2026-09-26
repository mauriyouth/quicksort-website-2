import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getTheme, setTheme, type QuicksortTheme } from "./theme";

export type ThemeToggleProps = {
  /** Controlled mode. Omit for uncontrolled (reads/writes the DOM + localStorage). */
  theme?: QuicksortTheme;
  onChange?: (theme: QuicksortTheme) => void;
  /** "root" flips <html> (persisted); "local" flips the nearest [data-theme] subtree. */
  target?: "root" | "local";
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  labels?: [string, string];
  style?: CSSProperties;
  className?: string;
};

/** The Quicksort mode switch. Flips the data-theme token scope between light and dark. */
export function ThemeToggle({
  theme,
  onChange,
  target = "root",
  size = "md",
  showLabel = false,
  labels = ["Light", "Dark"],
  style,
  className,
}: ThemeToggleProps) {
  const uncontrolled = theme === undefined;
  const [inner, setInner] = useState<QuicksortTheme>("light");
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!uncontrolled) return;
    const el =
      target === "root"
        ? document.documentElement
        : (ref.current?.parentElement ?? null);
    setInner(getTheme(el));
  }, [uncontrolled, target]);

  const current = uncontrolled ? inner : theme;
  const isDark = current === "dark";

  const H = size === "sm" ? 24 : size === "lg" ? 40 : 32;
  const W = H * 1.8;
  const pad = Math.round(H * 0.125);
  const knob = H - pad * 2;

  function flip() {
    const next: QuicksortTheme = isDark ? "light" : "dark";
    if (uncontrolled) {
      const el =
        target === "root"
          ? undefined
          : (ref.current?.closest("[data-theme]") ?? ref.current?.parentElement);
      setTheme(next, el);
      setInner(next);
    }
    onChange?.(next);
  }

  const track: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    width: W,
    height: H,
    padding: pad,
    border: "1px solid var(--qs-border-strong)",
    borderRadius: 999,
    background: "var(--qs-bg-2)",
    cursor: "pointer",
    transition:
      "background var(--qs-dur-2) var(--qs-ease), border-color var(--qs-dur-2) var(--qs-ease)",
    WebkitTapHighlightColor: "transparent",
    appearance: "none",
    outlineOffset: 3,
  };
  const dot: CSSProperties = {
    position: "absolute",
    top: pad,
    left: pad,
    width: knob,
    height: knob,
    borderRadius: 999,
    background: isDark ? "var(--qs-accent)" : "var(--qs-fg-1)",
    transform: `translateX(${isDark ? W - knob - pad * 2 : 0}px)`,
    transition:
      "transform var(--qs-dur-3) var(--qs-ease-out), background var(--qs-dur-2) var(--qs-ease)",
    pointerEvents: "none",
  };

  const button = (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={flip}
      className={className}
      style={showLabel ? track : { ...track, ...style }}
    >
      <span style={dot} />
    </button>
  );

  if (!showLabel) return button;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--qs-space-3)",
        font: `500 ${size === "sm" ? 13 : 14}px/1 var(--qs-font-sans)`,
        letterSpacing: "0.02em",
        color: "var(--qs-fg-2)",
        ...style,
      }}
      className={className}
    >
      {button}
      <span>{(isDark ? labels[1] : labels[0]) as ReactNode}</span>
    </span>
  );
}
