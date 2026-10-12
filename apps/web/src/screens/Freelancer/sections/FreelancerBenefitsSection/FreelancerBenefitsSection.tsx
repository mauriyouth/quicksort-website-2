import { useLocale } from '@lib/i18n';
import { Eyebrow } from '@components/QsMarks';

const benefits = [
  {
    title: "Long-term missions",
    body: "Engagements measured in months, not weeks. Deep, meaningful work with enterprise clients in banking, aerospace, utilities and hospitality.",
  },
  {
    title: "You focus on the craft",
    body: "Contracts, negotiations, invoicing and client relationships are handled by your dedicated Quicksort partner — so you can focus on delivery.",
  },
  {
    title: "Paid on time, every time",
    body: "Honest rate discussions upfront and predictable payment terms. No chasing invoices, no surprises.",
  },
  {
    title: "The right mission fit",
    body: "We match on skills, domain and working style — and we give you straight answers, whether it's a yes or a no.",
  },
  {
    title: "A team behind you",
    body: "You're never alone on a mission: engineers, researchers and designers review, unblock and ship alongside you.",
  },
  {
    title: "Grow your practice",
    body: "Exposure to production-grade AI across industries, with missions that compound your expertise over time.",
  },
];

/** Exactly one card carries the accent — the section's single signal. */
const SIGNAL_BENEFIT_INDEX = 1;

export const FreelancerBenefitsSection = (): JSX.Element => {
  const { t } = useLocale();
  return (
    <section className="w-full px-4 sm:px-8 py-12 sm:py-16 lg:py-24">
      <div className="mx-auto w-full max-w-screen-xl">
        <div className="mx-auto w-full max-w-4xl pt-[30px] pb-[26px] bg-surface text-ink">
          <div className="mx-auto max-w-[40ch] mb-[26px] text-center">
            <div className="mb-3">
              <Eyebrow>{t("Why freelancers work with us")}</Eyebrow>
            </div>
            <h2 className="font-qs-display font-normal text-[28px] sm:text-[34px] leading-[1.08] tracking-[-0.02em] text-ink text-pretty">{t("Built for independent experts")}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {benefits.map((benefit, index) => {
              const signal = index === SIGNAL_BENEFIT_INDEX;
              return (
                <div
                  key={benefit.title}
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
                  <h3 className={`font-qs-display font-normal text-[17px] leading-[1.2] tracking-[-0.01em] text-pretty ${signal ? "text-signal-fg" : "text-ink"}`}>{t(benefit.title)}</h3>
                  <p className={`font-qs-sans font-normal text-[13px] leading-[1.5] text-pretty ${signal ? "text-signal-fg/80" : "text-ink-2"}`}>{t(benefit.body)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
