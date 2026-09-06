import { useLocale } from '@lib/i18n';
import AiForBusinessIcon from "@components/AiForBusinessIcon";

export const BusinessOverviewSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  const features = [
    {
      title: "Explainable Agent Behavior",
      description:
        "Clear reasoning, traceability, and decision visibility so users understand why an agent acts, not just what it outputs.",
    },
    {
      title: "Progressive Autonomy Design",
      description:
        "Agents evolve from assistive â†’ collaborative â†’ autonomous, at a pace aligned with team maturity and risk tolerance.",
    },
    {
      title: "Adoption-First Product Design",
      description:
        "Onboarding, feedback loops, and interaction patterns designed to make AI a habit, not a disruption.",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-8 sm:gap-12 md:gap-16 w-full bg-surface">
      <div className="flex flex-col items-center justify-center gap-12 sm:gap-16 md:gap-20 px-0 py-12 sm:py-16 md:py-24 w-full bg-surface">
        <div className="flex flex-col lg:flex-row items-center justify-center gap-8 sm:gap-12 lg:gap-[130px] max-w-screen-xl w-full px-4 sm:px-8">
          <div className="flex flex-col items-start gap-8 sm:gap-10 md:gap-12 flex-1 min-w-0 w-full lg:w-auto">
            <div className="flex flex-col items-start gap-3 w-full">
              <p className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-cat-blue text-sm sm:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">{t("\n                From AI capability to everyday leverage\n              ")}</p>

              <h1 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-ink text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">{t("\n                Designing intelligent work adoption\n              ")}</h1>
            </div>

            <div className="flex flex-col items-start gap-4 sm:gap-6 w-full">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-4 w-full">
                  <div className="flex flex-col items-start gap-4 sm:gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h3 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-ink text-lg sm:text-xl md:text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {t(feature.title)}
                      </h3>

                      <p className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-ink-muted text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {t(feature.description)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center w-full lg:w-[430px] lg:h-[430px]">
            <AiForBusinessIcon />
          </div>
        </div>
      </div>
    </section>
  );
};
