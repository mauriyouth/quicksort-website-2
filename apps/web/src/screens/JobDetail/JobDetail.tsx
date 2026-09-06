import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useLocale, LocaleLink as Link } from "@lib/i18n";
import { usePublishedJobs } from "@lib/usePublishedJobs";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  MapPinIcon,
  BriefcaseIcon,
} from "lucide-react";
import { Button } from "@components/ui/button";
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
          <ArrowLeftIcon size={18} />
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
            <p className="text-signal-text mb-3">{job.department}</p>
            <h1 className="text-ink text-3xl sm:text-5xl font-semibold mb-6">
              {job.title}
            </h1>
            <div className="flex flex-wrap gap-6 text-ink-muted mb-10">
              <span className="inline-flex gap-2">
                <MapPinIcon size={20} />
                {job.location}
              </span>
              <span className="inline-flex gap-2">
                <BriefcaseIcon size={20} />
                {job.employment_type}
              </span>
            </div>
            <a href={job.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex self-start items-center gap-2 rounded-lg bg-ink text-surface px-6 py-3 font-semibold mb-10">
              {t("Apply on LinkedIn")} <ArrowUpRightIcon size={18} />
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
                  <ArrowUpRightIcon size={18} />
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
