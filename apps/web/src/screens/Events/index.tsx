import { useEvents } from '@lib/useEvents';
import { CircularGallery } from '@components/ui/circular-gallery';
import { MainNavigationSection } from '@components/MainNavigationSection';
import { SiteFooter } from '@components/SiteFooter';
import { useLocale } from '@lib/i18n';

export const Events = (): JSX.Element => {
  const { t, locale } = useLocale();
  const { events, loading, error } = useEvents();
  const dateFormat = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });

  return (
    <main className="flex flex-col w-full items-center relative bg-surface overflow-x-hidden">
      <img className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none" alt="" src="/background-pattern.svg" />
      <MainNavigationSection />
      <section className="relative w-full max-w-screen-xl px-4 sm:px-8 pt-10 sm:pt-12 md:pt-16 pb-8 sm:pb-12">
        <div className="max-w-screen-md">
          <p className="font-qs-sans font-semibold text-signal-text mb-3">{t('Events')}</p>
          <h1 className="font-qs-sans font-semibold text-ink text-3xl sm:text-4xl md:text-5xl tracking-tight leading-[1.1]">{t('Meet. Build. Share.')}</h1>
          <p className="mt-4 text-ink-muted text-base sm:text-lg leading-relaxed">{t('Join us in Paris for technical talks, hands-on sessions and conversations with the people building AI.')}</p>
        </div>
        {loading && <p role="status" className="py-16 text-ink-muted">{locale === 'fr' ? 'Chargement des événements…' : 'Loading events…'}</p>}
        {!loading && error && <p role="alert" className="py-16 text-ink-muted">{locale === 'fr' ? 'Impossible de charger les événements. Veuillez réessayer.' : 'Events could not be loaded. Please try again.'}</p>}
        {!loading && !error && !events.length && <p className="py-16 text-ink-muted">{locale === 'fr' ? 'De nouveaux événements seront annoncés prochainement.' : 'New events will be announced soon.'}</p>}
        {!!events.length && <CircularGallery
          className="mx-auto mt-6 max-w-[760px]"
          items={events.map(event => ({
            title: event.title,
            date: event.event_date,
            dateLabel: dateFormat.format(new Date(event.event_date + 'T12:00:00Z')),
            location: event.location,
            href: event.event_url,
            image: event.banner_url,
          }))}
          labels={locale === 'fr' ? {
            gallery: 'Galerie des événements', previous: 'Événement précédent', next: 'Événement suivant',
            view: 'Voir sur Luma',
          } : {
            gallery: 'Event gallery', previous: 'Previous event', next: 'Next event',
            view: 'View on Luma',
          }}
        />}
      </section>
      <SiteFooter />
    </main>
  );
};
