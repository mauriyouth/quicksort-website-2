import { useLocale, LocaleLink as Link } from '@lib/i18n';
import { Eyebrow, ArrowGlyph } from '@components/QsMarks';
import { Button } from "@components/ui/button";

export const FreelancerCtaSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  return (
    <section className="w-full px-4 sm:px-8 pb-12 sm:pb-16 lg:pb-24">
      <div className="mx-auto w-full max-w-screen-xl">
        <div className="flex flex-col items-center gap-5 px-6 sm:px-12 py-12 sm:py-16 rounded-[14px] bg-surface-raised border border-line text-center">
          <Eyebrow>{t("Join the network")}</Eyebrow>

          <h2 className="font-qs-display font-normal text-ink text-2xl sm:text-3xl md:text-4xl leading-[1.08] tracking-[-0.02em] text-pretty max-w-[22ch]">{t("Ready for your next mission?")}</h2>

          <p className="font-qs-sans text-base sm:text-lg leading-relaxed text-ink-2 max-w-[52ch]">{t("Tell us what you do best and we'll match you with enterprise missions worth your time — as a freelancer, not a ticket in a queue.")}</p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
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
