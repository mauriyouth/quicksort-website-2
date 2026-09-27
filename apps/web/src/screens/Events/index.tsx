import { ArrowUpRight, CalendarDays, MapPin } from 'lucide-react';
import { MainNavigationSection } from '@components/MainNavigationSection';
import { SiteFooter } from '@components/SiteFooter';
import { useLocale } from '@lib/i18n';

const events = [
  {
    title: 'Cafe Compute Meetup: Paris',
    date: '2026-09-30T19:00:00+02:00',
    banner: '/events/cafe-compute-paris.jpg',
    url: 'https://luma.com/ccparis',
    description: 'Live demos, hands-on building and technical conversations with Cerebras, OpenAI, The AI Collective and Quicksort.',
  },
  {
    title: 'Multimodal AI in Production (w/ The AI Collective)',
    date: '2026-10-01T19:00:00+02:00',
    banner: '/events/multimodal-ai.jpg',
    url: 'https://luma.com/quicksort-multimodal-ai',
    description: 'An evening with The AI Collective exploring multimodal retrieval, Voice AI and agentic systems in production.',
  },
];

export const Events = (): JSX.Element => {
  const { t, locale } = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });

  return (
    <main className="flex flex-col w-full items-center relative bg-surface overflow-x-hidden">
      <img className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none" alt="" src="/background-pattern.svg" />
      <MainNavigationSection />
      <section className="relative w-full max-w-screen-xl px-4 sm:px-8 pt-12 sm:pt-16 md:pt-24 pb-12 sm:pb-16">
        <div className="max-w-screen-md">
          <p className="font-qs-sans font-semibold text-signal-text mb-3">{t('Events')}</p>
          <h1 className="font-qs-sans font-semibold text-ink text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.1]">{t('Meet. Build. Share.')}</h1>
          <p className="mt-6 text-ink-muted text-lg sm:text-xl leading-relaxed">{t('Join us in Paris for technical talks, hands-on sessions and conversations with the people building AI.')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12 sm:mt-16">
          {events.map(event => (
            <article key={event.url} className="min-w-0">
              <a href={event.url} target="_blank" rel="noopener noreferrer" className="group flex h-full flex-col rounded-2xl border border-line bg-surface-raised overflow-hidden transition-colors hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal">
                <img src={event.banner} alt={event.title} width={1080} height={1080} className="w-full aspect-square object-contain" />
                <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
                    <span className="inline-flex items-center gap-2"><CalendarDays className="w-4 h-4" aria-hidden="true" /><time dateTime={event.date}>{dateFormat.format(new Date(event.date))}</time></span>
                    <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4" aria-hidden="true" />Paris, France</span>
                  </div>
                  <h2 className="font-qs-sans text-2xl sm:text-3xl font-semibold tracking-tight text-ink leading-tight">{event.title}</h2>
                  <p className="text-ink-muted leading-relaxed">{t(event.description)}</p>
                  <span className="inline-flex items-center gap-2 mt-auto pt-4 font-semibold text-signal-text">{t('View event on Luma')}<ArrowUpRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /></span>
                </div>
              </a>
            </article>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
};
