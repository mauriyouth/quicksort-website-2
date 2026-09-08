import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useLocale, LocaleLink as Link } from "@lib/i18n";
import { usePublishedJobs } from "@lib/usePublishedJobs";
import { Button } from "@components/ui/button";
import { ArrowGlyph, SignalChip } from "@components/QsMarks";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";
import { JobDescription } from "./JobDescription";
export const JobDetail = (): JSX.Element => {
  const { slug } = useParams();
  const { t } = useLocale();
  const { jobs, loading, error, refresh } = usePublishedJobs();
  const job = jobs.find((j) => j.slug === slug);
  useEffect(() => {
    if (loading) return;
    document.title = job
      ? `${job.title} | Quicksort`
      : "Job unavailable | Quicksort";
    const robots = document.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    if (robots) robots.content = job ? "index, follow" : "noindex, follow";
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (description && job) description.content = job.description.slice(0, 160);
  }, [job, loading]);
  return (
    <main className="flex flex-col w-full items-center bg-surface min-h-screen overflow-x-hidden">
      <MainNavigationSection />
      <article className="flex flex-col max-w-4xl w-full px-4 sm:px-8 py-12 sm:py-16 md:py-24">
        <Link
          to="/career"
          className="text-ink-muted inline-flex items-center gap-2 mb-8"
        >
          <span aria-hidden="true">←</span>
          {t("Back to Careers")}
        </Link>
        {loading ? (
          <p className="text-ink-muted" role="status">
            {t("Loading opportunity…")}
          </p>
        ) : error ? (
          <div role="alert" className="text-ink-muted">
            <h1 className="text-2xl">{t("Unable to load this role")}</h1>
            <p>{t(error)}</p>
            <button onClick={refresh} className="underline">
              {t("Try again")}
            </button>
          </div>
        ) : !job ? (
          <>
            <h1 className="text-3xl text-ink font-semibold">
              {t("This role is no longer available")}
            </h1>
            <p className="text-ink-muted mt-4">
              {t("Explore our careers page for current opportunities.")}
            </p>
          </>
        ) : (
          <>
            <div className="mb-4">
              <SignalChip>{job.department}</SignalChip>
            </div>
            <h1 className="font-qs-display font-normal text-ink text-3xl sm:text-5xl leading-[1.08] tracking-[-0.02em] text-pretty mb-5">
              {job.title}
            </h1>
            <p className="flex flex-wrap items-center gap-2 font-qs-mono text-[12px] leading-[1.4] text-ink-muted mb-10">
              {job.location}
              <span className="text-ink-faint" aria-hidden="true">·</span>
              {job.employment_type}
            </p>
            <a
              href={job.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start inline-flex items-center gap-[9px] py-[9px] px-[15px] mb-10 rounded-qs-pill border border-line-strong bg-transparent font-qs-sans font-medium text-[13px] leading-none text-ink transition-colors duration-qs-2 ease-qs hover:bg-surface-sunken"
            >
              {t("Apply on LinkedIn")}
              <ArrowGlyph />
            </a>
            <div className="border-t border-line pt-8 mb-12">
              <JobDescription text={job.description} />
            </div>
            <div>
              <a
                href={job.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="signal" size="qs-lg">
                  {t("Apply on LinkedIn")}
                  <ArrowGlyph />
                </Button>
              </a>
            </div>
          </>
        )}
      </article>
      <SiteFooter />
    </main>
  );
};
