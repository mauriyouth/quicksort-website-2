import type * as React from 'react';

export type QsTheme = 'light' | 'dark' | 'auto';

export interface ThemeToggleProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** Controlled mode. Omit to let the switch manage and persist its own state. */
  theme?: QsTheme;
  /** Fired with the new mode on every flip. */
  onChange?: (theme: QsTheme) => void;
  /** `root` writes data-theme on <html> (and localStorage). `local` flips only the nearest [data-theme] subtree. */
  target?: 'root' | 'local';
  size?: 'sm' | 'md' | 'lg';
  /** Show a text label beside the switch. */
  showLabel?: boolean;
  /** Label pair, [light, dark]. */
  labels?: [string, string];
}

/** Quicksort mode switch. Flips the `data-theme` token scope between light and dark. */
export declare function ThemeToggle(props: ThemeToggleProps): React.ReactElement;

/** Read the mode in effect for an element (walks up to <html>). */
export declare function getTheme(el?: Element): QsTheme;
/** Set the mode on a target element (default <html>) and persist it. */
export declare function setTheme(theme: QsTheme, target?: Element): QsTheme;
/** Restore the persisted mode. Call early to avoid a flash of the wrong ground. */
export declare function restoreTheme(fallback?: QsTheme): QsTheme;
