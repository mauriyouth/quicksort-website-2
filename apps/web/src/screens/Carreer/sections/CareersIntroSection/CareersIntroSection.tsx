import { useLocale } from '@lib/i18n';
import { Eyebrow } from '@components/QsMarks';

export const CareersIntroSection = (): JSX.Element => {
  const { t } = useLocale();
  return (
    <section className="flex flex-col w-full items-center px-4 sm:px-8 pt-12 sm:pt-16 md:pt-24">
      <div className="w-full max-w-screen-xl">
        <div className="flex flex-col items-start gap-3 max-w-screen-md">
          <Eyebrow>{t("Careers")}</Eyebrow>

          <h1 className="font-qs-display font-normal text-ink text-3xl sm:text-4xl md:text-5xl leading-[1.08] tracking-[-0.02em] text-pretty">{t("We're building the future of human-AI collaboration")}</h1>
        </div>
      </div>
    </section>
  );
};
