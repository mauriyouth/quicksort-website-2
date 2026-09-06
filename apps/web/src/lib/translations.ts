import type { Locale } from './locales';
import rows from './translations.json';
const dictionary = new Map(rows.map(row => [row[0], row]));
export function translate(value: string, locale: Locale): string {
  if (locale === 'en') return value;
  const key = value.replace(/\s+/g, ' ').trim();
  const row = dictionary.get(key);
  if (!row) return value;
  return value.replace(/\S[\s\S]*\S|\S/, row[1]);
}
