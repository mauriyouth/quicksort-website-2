const STORAGE_KEY = "qs-theme";

export type QuicksortTheme = "light" | "dark";

/** Read the mode currently in effect for an element (walks up to <html>). */
export function getTheme(el?: Element | null): QuicksortTheme {
  const node = (el ?? document.documentElement).closest("[data-theme]");
  const value = node?.getAttribute("data-theme");
  return value === "dark" ? "dark" : "light";
}

/** Set the mode on a target element (default <html>) and persist it. */
export function setTheme(
  theme: QuicksortTheme,
  target?: Element | null,
): QuicksortTheme {
  const el = target ?? document.documentElement;
  el.setAttribute("data-theme", theme);
  if (!target) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme just won't persist */
    }
  }
  return theme;
}

/** Restore the persisted mode. Call early to avoid a flash of the wrong ground. */
export function restoreTheme(fallback: QuicksortTheme = "light"): QuicksortTheme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  return setTheme(saved === "dark" ? "dark" : fallback);
}
