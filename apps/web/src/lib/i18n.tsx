import { createContext, useContext, type ReactNode } from 'react';
import { Link, useLocation, type LinkProps } from 'react-router-dom';
import { splitLocale, localePath, type Locale } from './locales';
import { translate } from './translations';

const LocaleContext = createContext<Locale>('en');
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <LocaleContext.Provider value={splitLocale(pathname).locale}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const locale = useContext(LocaleContext);
  return { locale, t: <T,>(value: T): T => (typeof value === 'string' ? translate(value, locale) : value) as T,
    localize: (path: string) => localePath(path, locale) };
}
export function LocaleLink({ to, ...props }: LinkProps) {
  const { locale } = useLocale();
  const target = typeof to === 'string' ? localePath(to, locale) : { ...to, pathname: to.pathname ? localePath(to.pathname, locale) : undefined };
  return <Link {...props} to={target} />;
}
