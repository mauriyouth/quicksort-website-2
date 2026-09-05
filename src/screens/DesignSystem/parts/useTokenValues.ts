import { useEffect, useState } from "react";
import { useTheme } from "@lib/theme";

/**
 * Resolve design tokens to the value the browser is actually using.
 *
 * The page reads its own tokens rather than repeating their values, so a
 * swatch can never drift from what the site ships. Re-resolves whenever
 * the theme changes.
 */
export const useTokenValues = (names: string[]): Record<string, string> => {
    const { theme } = useTheme();
    const [values, setValues] = useState<Record<string, string>>({});
    const key = names.join(",");

    useEffect(() => {
        // The theme swap and this read both land in the same frame, so wait
        // one frame for the new values to be committed.
        const id = requestAnimationFrame(() => {
            const styles = getComputedStyle(document.documentElement);
            const next: Record<string, string> = {};
            for (const name of key.split(",")) {
                next[name] = styles.getPropertyValue(`--qs-${name}`).trim();
            }
            setValues(next);
        });

        return () => cancelAnimationFrame(id);
    }, [key, theme]);

    return values;
};

/** `rgb(204, 255, 0)` → `#CCFF00`. Leaves anything else untouched. */
export const toHex = (value: string): string => {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return value.toUpperCase();

    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return value;

    const hex = parts
        .slice(0, 3)
        .map((n) => Math.round(n).toString(16).padStart(2, "0"))
        .join("");

    // A fourth component is alpha, which a hex triplet cannot carry.
    const alpha = parts[3];
    return alpha !== undefined && alpha < 1
        ? `#${hex.toUpperCase()} · ${Math.round(alpha * 100)}%`
        : `#${hex.toUpperCase()}`;
};
