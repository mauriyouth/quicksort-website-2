import { useLocale, LocaleLink as Link } from '@lib/i18n';
import { Eyebrow, ArrowGlyph } from '@components/QsMarks';
import { Button } from "@components/ui/button";

export const FreelancerIntroSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  return (
    <section className="flex flex-col w-full items-center px-4 sm:px-8 pt-12 sm:pt-16 md:pt-24">
      <div className="w-full max-w-screen-xl">
        <div className="flex flex-col items-start gap-5 max-w-screen-md">
          <Eyebrow>{t("Freelancer")}</Eyebrow>

          <h1 className="font-qs-display font-normal text-ink text-3xl sm:text-4xl md:text-5xl leading-[1.08] tracking-[-0.02em] text-pretty">{t("Freelance missions that build serious AI")}</h1>

          <p className="font-qs-sans text-base sm:text-lg leading-relaxed text-ink-2">{t("Join Quicksort's network of freelance engineers, data specialists and AI experts. Work on long-term enterprise missions — AI agents, data systems, private infrastructure and voice AI — with a team that takes care of everything around the craft.")}</p>

          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Button asChild variant="signal" size="qs">
              <Link to="/career">
                {t("See open missions")}
                <ArrowGlyph />
              </Link>
            </Button>
            <Button asChild variant="outline" size="qs">
              <a href={localize("mailto:hello@quicksort.fr?subject=Freelance%20mission")}>
                {t("Introduce yourself")}
                <ArrowGlyph />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
