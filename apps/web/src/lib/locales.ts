export const locales = ['en', 'fr'] as const;
export type Locale = typeof locales[number];
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const match = pathname.match(/^\/(fr)(?=\/|$)/);
  return { locale: (match?.[1] || 'en') as Locale, path: (match ? pathname.slice(match[0].length) : pathname).replace(/\/+$/, '') || '/' };
}
export function localePath(path: string, locale: Locale): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const [, pathname, suffix] = path.match(/^([^?#]*)(.*)$/s)!;
  const base = splitLocale(pathname).path;
  // Assets and the internal signature utility do not have language variants.
  if (/\.[a-z0-9]+$/i.test(base) || ['/email-signature', '/design-system'].includes(base)) return path;
  return (locale === 'en' ? base : `/${locale}${base === '/' ? '' : base}`) + suffix;
}
