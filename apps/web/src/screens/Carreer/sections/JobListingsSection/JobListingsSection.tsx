import { usePublishedJobs } from '@lib/usePublishedJobs';
import { useLocale } from '@lib/i18n';
import { LocaleLink as Link } from '@lib/i18n';
import { ArrowGlyph, Eyebrow, SignalChip } from '@components/QsMarks';
import { Button } from '@components/ui/button';

/**
 * Careers page body — built to the Quicksort design-system handoff
 * (quicksort-design-system/exports/design_handoff_careers_sections).
 *
 * Two rules from the system drive the look here:
 *   1. One accent per section. Signal Lime is a signal, not a decoration,
 *      so it appears as a single 5px dot or a single filled card — never
 *      as a second palette of category colours.
 *   2. No icon set. The identity is logo- and type-forward, so metadata
 *      is mono text rather than a pin/clock glyph.
 */

const values = [
  {
    title: "Bias for action",
    body: "We move fast, make decisions, and iterate. Speed matters. We ship and learn.",
  },
  {
    title: "Excellence",
    body: "We hold ourselves to the highest standards. Good isn't good enough. We aim for exceptional.",
  },
  {
    title: "Leave your ego aside",
    body: "The best ideas win, not the loudest voices. We collaborate with humility and respect.",
  },
];

/** Exactly one value card carries the accent — the section's single signal. */
const SIGNAL_VALUE_INDEX = 1;

const teamImages = [
  {
    position: "top-0 left-[51.39%]",
    size: "w-[27.78%] h-[48.39%]",
    style: "[background:url(/team/ahmednah-320.webp)_50%_50%_/_cover]",
  },
  {
    position: "top-[51.61%] left-[66.67%]",
    size: "w-1/3 h-[35.48%]",
    style: "[background:url(/team/mirette-320.webp)_50%_50%_/_cover]",
  },
  {
    position: "top-[51.61%] left-0",
    size: "w-1/3 h-[38.71%]",
    style: "[background:url(/team/nageeta-320.webp)_50%_50%_/_cover]",
  },
  {
    position: "top-[51.61%] left-[36.11%]",
    size: "w-[27.78%] h-[48.39%]",
    style: "[background:url(/team/amadou-320.webp)_50%_50%_/_cover]",
  },
  {
    position: "top-[16.13%] left-[20.83%]",
    size: "w-[27.78%] h-[32.26%]",
    style: "[background:url(/team/dridi-320.webp)_50%_50%_/_cover]",
  },
];

export const JobListingsSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  const { jobs, loading, error, refresh } = usePublishedJobs();

  return (
    <section className="flex flex-col items-center w-full">
      {/* ── Who we are ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center gap-12 sm:gap-16 pt-8 sm:pt-12 lg:pt-24 w-full px-4 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 mx-auto w-full max-w-screen-xl items-center gap-12 lg:gap-16">
          <div className="flex flex-col min-w-0 w-full items-start gap-8">
            <div className="flex flex-col max-w-screen-md items-start gap-5 w-full">
              <p className="font-qs-sans text-base sm:text-lg leading-relaxed text-ink-2">{t("Quicksort is an AI services firm based in Paris, working with major enterprises across banking, aerospace, utilities, and hospitality. We don't just implement AI; we fundamentally transform how organizations leverage intelligent systems to amplify human capability.")}</p>

              <p className="font-qs-sans text-base sm:text-lg leading-relaxed text-ink-2">{t("Our philosophy is grounded in a simple equation: ")}<span className="text-ink font-medium">{t("Human + AI = Compound Value")}</span>{t(". We believe the future isn't about AI replacing people, but about collaborative systems that make teams more effective, decisions more informed, and businesses more resilient.")}</p>

              <div className="mt-2">
                <h3 className="font-qs-display text-[19px] leading-[1.2] tracking-[-0.01em] text-ink mb-3">{t("What we do")}</h3>
                <p className="font-qs-sans text-[14px] leading-[1.55] text-ink-2 mb-4">{t("We partner with C-level executives and technical leaders to design and implement AI transformation strategies that actually work. Our focus is on:")}</p>
                <ul className="flex flex-col gap-2.5 font-qs-sans text-[14px] leading-[1.55] text-ink-2">
                  {[
                    "Strategic AI services for banking, finance, and enterprise sectors",
                    "Agentic AI systems that enhance rather than automate",
                    "Custom AI copilots tailored to specific business processes",
                    "End-to-end implementation from strategy to deployment",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="mt-[9px] w-[5px] h-[5px] shrink-0 rounded-qs-pill bg-ink-faint" aria-hidden="true" />
                      {t(item)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <Button asChild variant="signal" size="qs">
              <a href={localize("mailto:hello@quicksort.fr")}>
                {t("Get in touch")}
                <ArrowGlyph />
              </a>
            </Button>
          </div>

          <div className="relative min-w-0 w-full max-w-xl mx-auto aspect-[576/496]" aria-hidden="true">
            {teamImages.map((image) => (
              <div
                key={image.style}
                className={`absolute ${image.position} ${image.size} ${image.style}`}
              />
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-screen-xl">
          <img className="w-full" alt="" src="/container.svg" />
        </div>
      </div>

      {/* ── Values · direction A, numerals over a hairline ──────────── */}
      <div className="w-full px-4 sm:px-8 py-12 sm:py-16 lg:py-24">
        <div className="mx-auto w-full max-w-screen-xl">
          <div className="mx-auto w-full max-w-4xl pt-[30px] pb-[26px] bg-surface text-ink">
            <div className="mx-auto max-w-[40ch] mb-[26px] text-center">
              <div className="mb-3">
                <Eyebrow>{t("Who you'll work with")}</Eyebrow>
              </div>
              <h2 className="font-qs-display font-normal text-[28px] sm:text-[34px] leading-[1.08] tracking-[-0.02em] text-ink text-pretty">{t("Some of our core values")}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {values.map((value, index) => {
                const signal = index === SIGNAL_VALUE_INDEX;
                return (
                  <div
                    key={value.title}
                    className={`flex flex-col gap-2.5 p-[18px] rounded-[14px] border ${
                      signal
                        ? "bg-signal border-transparent"
                        : "bg-surface-raised border-line"
                    }`}
                  >
                    <div
                      className={`font-qs-mono font-normal text-[13px] leading-none pb-3.5 border-b ${
                        signal ? "text-signal-fg/50 border-signal-fg/[0.18]" : "text-ink-faint border-line"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <h3 className={`font-qs-display font-normal text-[17px] leading-[1.2] tracking-[-0.01em] text-pretty ${signal ? "text-signal-fg" : "text-ink"}`}>{t(value.title)}</h3>
                    <p className={`font-qs-sans font-normal text-[13px] leading-[1.5] text-pretty ${signal ? "text-signal-fg/80" : "text-ink-2"}`}>{t(value.body)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Open roles ─────────────────────────────────────────────── */}
      <div className="w-full px-4 sm:px-8 pb-12 sm:pb-16 lg:pb-24">
        <div className="mx-auto w-full max-w-screen-xl">
          <div className="mx-auto w-full max-w-6xl pt-[30px] pb-[26px] bg-surface text-ink">
            <div className="mx-auto max-w-[50ch] mb-10 text-center">
              <h2 className="font-qs-display font-normal text-[26px] sm:text-[32px] leading-[1.1] tracking-[-0.02em] text-ink text-pretty mb-3.5">{t("We unite world-class talent to push boundaries and build what's next.")}</h2>
              <p className="font-qs-sans font-normal text-[14px] leading-[1.55] text-ink-2 text-pretty">{t("We believe in building teams where unique perspectives and talents can thrive and everyone has what they need to excel in their role, career, and at home.")}</p>
            </div>

            <div className="mx-auto w-full max-w-4xl flex flex-col gap-3.5">
              {loading && (
                <p className="font-qs-mono text-[12px] text-ink-muted" role="status">{t("Loading opportunities…")}</p>
              )}

              {error && (
                <div role="alert" className="font-qs-sans text-[14px] text-ink-2">
                  <p>{t(error)}</p>
                  <button onClick={refresh} className="mt-2 underline underline-offset-4 text-ink">{t("Try again")}</button>
                </div>
              )}

              {!loading && !error && jobs.length === 0 && (
                <p className="font-qs-sans text-[14px] text-ink-2">{t("No open roles right now. Check back soon or contact hello@quicksort.fr.")}</p>
              )}

              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-start gap-6 p-6 sm:p-7 rounded-[14px] bg-surface-raised border border-line transition-colors duration-qs-2 ease-qs hover:border-line-strong"
                >
                  <div className="flex flex-col gap-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-qs-display font-normal text-[19px] leading-[1.2] tracking-[-0.01em] text-ink">
                        <Link to={`/career/${job.slug}`} className="hover:underline underline-offset-4 break-words">{job.title}</Link>
                      </h3>

                      <SignalChip>{t(job.department)}</SignalChip>
                    </div>

                    <p className="flex flex-wrap items-center gap-2 font-qs-mono font-normal text-[12px] leading-[1.4] text-ink-muted">
                      {t(job.location)}
                      <span className="text-ink-faint" aria-hidden="true">·</span>
                      {t(job.employment_type)}
                    </p>

                    <a
                      href={job.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="self-start inline-flex items-center gap-[9px] py-[9px] px-[15px] rounded-qs-pill border border-line-strong bg-transparent font-qs-sans font-medium text-[13px] leading-none text-ink transition-colors duration-qs-2 ease-qs hover:bg-surface-sunken"
                    >
                      {t("Apply on LinkedIn")}
                      <ArrowGlyph />
                    </a>
                  </div>

                  <Link
                    to={`/career/${job.slug}`}
                    className="inline-flex items-center gap-2 pt-1 font-qs-sans font-medium text-[13px] leading-none text-ink whitespace-nowrap no-underline transition-colors duration-qs-2 ease-qs hover:text-ink-2"
                  >
                    {t("Know More")}
                    <ArrowGlyph />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
