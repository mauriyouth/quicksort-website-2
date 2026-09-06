import { useLocale } from '@lib/i18n';
import { useParams } from 'react-router-dom';
import { LocaleLink as Link } from '@lib/i18n';
import { ArrowLeftIcon, MapPinIcon, BriefcaseIcon, DollarSignIcon, ClockIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

import { jobsData } from "@lib/jobs";

export const JobDetail = (): JSX.Element => {
  const { t, localize } = useLocale();
    const { slug } = useParams<{ slug: string }>();
    const job = slug ? jobsData[slug] : undefined;

    if (!job) {
        return (
            <main className="flex flex-col w-full items-center relative bg-surface min-h-screen overflow-x-hidden">
                <MainNavigationSection />
                <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
                    <h1 className="text-2xl font-bold text-ink mb-4">{t("Job Not Found")}</h1>
                    <Link to="/career">
                        <Button variant="outline">{t("Back to Careers")}</Button>
                    </Link>
                </div>
                <SiteFooter />
            </main>
        );
    }

    return (
        <main className="flex flex-col w-full items-center relative bg-surface min-h-screen overflow-x-hidden">
            <img
                className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none"
                alt={t("")}
                src="/background-pattern.svg"
            />

            <MainNavigationSection />

            <article className="flex flex-col max-w-4xl w-full px-4 sm:px-8 py-12 sm:py-16 md:py-24 relative z-10">
                {/* Back navigation */}
                <div className="mb-8">
                    <Link to="/career">
                        <Button
                            variant="ghost"
                            className="gap-2 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent mb-6"
                        >
                            <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-ink-muted" />
                            <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-ink-muted text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] [font-style:var(--text-sm-semibold-font-style)]">{t("\n                                Back to Careers\n                            ")}</span>
                        </Button>
                    </Link>
                </div>

                {/* Job header */}
                <header className="mb-10">
                    <h1 className="font-display-lg-semibold font-[number:var(--display-lg-semibold-font-weight)] text-ink text-3xl sm:text-4xl md:text-5xl tracking-[var(--display-lg-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-lg-semibold-line-height)] [font-style:var(--display-lg-semibold-font-style)] mb-6">
                        {t(job.title)}
                    </h1>

                    {/* Job meta info */}
                    <div className="flex flex-wrap gap-4 sm:gap-6">
                        <div className="inline-flex items-center gap-2 text-ink-muted">
                            <MapPinIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{t(job.location)}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-ink-muted">
                            <BriefcaseIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{t(job.contractType)}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-ink-muted">
                            <ClockIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{t(job.experience)}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-ink-muted">
                            <DollarSignIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{t(job.salary)}</span>
                        </div>
                    </div>
                </header>

                {/* Who are we */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Who are we?")}</h2>
                    <p className="text-ink-muted text-base sm:text-lg leading-relaxed">
                        {t(job.companyDescription)}
                    </p>
                </section>

                {/* Your Mission */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Your Mission")}</h2>
                    <p className="text-ink-muted text-base sm:text-lg leading-relaxed">
                        {t(job.mission)}
                    </p>
                </section>

                {/* Project Examples */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Project Examples")}</h2>
                    <ul className="space-y-3">
                        {job.projectExamples.map((example, index) => (
                            <li key={index} className="flex items-start gap-3 text-ink-muted text-base sm:text-lg leading-relaxed">
                                <span className="text-signal-text mt-1.5">{t("•")}</span>
                                {t(example)}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Training and R&D */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Training and R&D")}</h2>
                    <p className="text-ink-muted text-base sm:text-lg leading-relaxed">
                        {t(job.trainingRnD)}
                    </p>
                </section>

                {/* Profile Sought */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Profile Sought")}</h2>
                    <ul className="space-y-3">
                        {job.profileRequirements.map((requirement, index) => (
                            <li key={index} className="flex items-start gap-3 text-ink-muted text-base sm:text-lg leading-relaxed">
                                <span className="text-signal-text mt-1.5">{t("•")}</span>
                                {t(requirement)}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Core Values */}
                <section className="mb-10">
                    <h2 className="text-ink text-xl sm:text-2xl font-semibold mb-4">{t("Some of our core values")}</h2>
                    <ul className="space-y-3">
                        {job.coreValues.map((value, index) => (
                            <li key={index} className="flex items-start gap-3 text-ink-muted text-base sm:text-lg leading-relaxed">
                                <span className="text-signal-text mt-1.5">{t("•")}</span>
                                {t(value)}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Closing statement */}
                <section className="mb-10 p-6 bg-surface-sunken/50 rounded-xl border border-line">
                    <p className="text-ink-2 text-lg sm:text-xl leading-relaxed italic">
                        {t(job.closingStatement)}
                    </p>
                </section>

                {/* Apply CTA */}
                <div className="flex justify-center">
                    <a href={localize("mailto:hello@quicksort.fr")}>
                        <Button variant="signal" size="qs-lg">{t("\n                            Apply Now\n                        ")}</Button>
                    </a>
                </div>
            </article>

            <SiteFooter />
        </main>
    );
};
