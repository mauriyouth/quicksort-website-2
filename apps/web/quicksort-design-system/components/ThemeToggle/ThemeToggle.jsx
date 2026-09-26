import React from 'react';

const STORAGE_KEY = 'qs-theme';

/** Read the mode currently in effect for an element (walks up to <html>). */
export function getTheme(el) {
  const node = (el || document.documentElement).closest('[data-theme]');
  return node ? node.getAttribute('data-theme') : 'light';
}

/** Set the mode on a target element (default <html>) and persist it. */
export function setTheme(theme, target) {
  const el = target || document.documentElement;
  el.setAttribute('data-theme', theme);
  if (!target) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }
  return theme;
}

/** Restore the persisted mode. Call early to avoid a flash of the wrong ground. */
export function restoreTheme(fallback) {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  return setTheme(saved || fallback || 'light');
}

export function ThemeToggle({
  theme,
  onChange,
  target = 'root',
  size = 'md',
  showLabel = false,
  labels = ['Light', 'Dark'],
  style,
  ...rest
}) {
  const uncontrolled = theme === undefined;
  const [inner, setInner] = React.useState('light');
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!uncontrolled) return;
    const el = target === 'root' ? document.documentElement : ref.current && ref.current.parentElement;
    setInner(getTheme(el));
  }, [uncontrolled, target]);

  const current = uncontrolled ? inner : theme;
  const isDark = current === 'dark';

  const H = size === 'sm' ? 24 : size === 'lg' ? 40 : 32;
  const W = H * 1.8;
  const pad = Math.round(H * 0.125);
  const knob = H - pad * 2;

  function flip() {
    const next = isDark ? 'light' : 'dark';
    if (uncontrolled) {
      const el = target === 'root' ? document.documentElement : ref.current.closest('[data-theme]') || ref.current.parentElement;
      setTheme(next, target === 'root' ? undefined : el);
      setInner(next);
    }
    if (onChange) onChange(next);
  }

  const track = {
    position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0,
    width: W, height: H, padding: pad, border: '1px solid var(--qs-border-strong)',
    borderRadius: 999, background: isDark ? 'var(--qs-bg-2)' : 'var(--qs-bg-2)',
    cursor: 'pointer', transition: 'background var(--qs-dur-2) var(--qs-ease), border-color var(--qs-dur-2) var(--qs-ease)',
    WebkitTapHighlightColor: 'transparent', appearance: 'none', outlineOffset: 3,
  };
  const dot = {
    position: 'absolute', top: pad, left: pad, width: knob, height: knob, borderRadius: 999,
    background: isDark ? 'var(--qs-accent)' : 'var(--qs-fg-1)',
    transform: `translateX(${isDark ? W - knob - pad * 2 : 0}px)`,
    transition: 'transform var(--qs-dur-3) var(--qs-ease-out), background var(--qs-dur-2) var(--qs-ease)',
    pointerEvents: 'none',
  };

  const button = React.createElement('button', {
    ref, type: 'button', role: 'switch', 'aria-checked': isDark,
    'aria-label': `Switch to ${isDark ? 'light' : 'dark'} mode`,
    onClick: flip, style: showLabel ? track : { ...track, ...style }, ...(showLabel ? {} : rest),
  }, React.createElement('span', { style: dot }));

  if (!showLabel) return button;

  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 'var(--qs-space-3)',
      font: `500 ${size === 'sm' ? 13 : 14}px/1 var(--qs-font-sans)`,
      letterSpacing: '0.02em', color: 'var(--qs-fg-2)', ...style,
    }, ...rest,
  }, button, React.createElement('span', null, isDark ? labels[1] : labels[0]));
}
