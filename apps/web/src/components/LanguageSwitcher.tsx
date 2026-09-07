import { useLocation, Link } from 'react-router-dom';
import { locales, localePath, splitLocale } from '../lib/locales';
import { useLocale } from '../lib/i18n';

export function LanguageSwitcher() {
  const { pathname, search, hash } = useLocation();
  const { locale, t } = useLocale();
  const names = { en: 'English', fr: 'Français' };
  return <details className="language-switcher">
    <summary aria-label={t('Change language')}><span aria-hidden="true">◎</span> {names[locale]} <span aria-hidden="true">⌄</span></summary>
    <nav aria-label={t('Language')}>
      {locales.map(language => <Link key={language} lang={language} hrefLang={language}
        to={localePath(splitLocale(pathname).path, language) + search + hash}
        aria-current={locale === language ? 'true' : undefined}
        onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>
        {names[language]} {locale === language && <span aria-hidden="true">✓</span>}
      </Link>)}
    </nav>
  </details>;
}
