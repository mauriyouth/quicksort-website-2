import { Button } from "../../../../components/ui/button";
import { SectionGridOverlay } from "../../../../components/SectionGridOverlay";
import { SectionSeparator } from "../../../../components/SectionSeparator";

export const HeroIntroSection = (): JSX.Element => {
  return (
    <section className="flex flex-col items-center relative w-full bg-[#141414]">
      <div className="h-[757px] px-0 py-24 z-[1] flex items-start justify-center relative w-full">
        <div className="flex max-w-screen-xl w-full items-center justify-between relative">
          <div className="flex max-w-screen-xl h-[515px] items-end gap-8 px-8 py-0 relative flex-1 grow">
            <div className="flex flex-col items-start gap-12 relative flex-1 self-stretch grow">
              <div className="flex flex-col max-w-screen-lg items-start gap-6 relative w-full">
                <h1 className="mt-[-1.00px] [font-family:'Hanken_Grotesk',Helvetica] font-medium text-6xl tracking-[-1.20px] leading-[72px] relative self-stretch text-[#f5f5f6]">
                  We Craft Human + AI Collaboration.
                </h1>

                <p className="relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  We design and engineer agentic systems where humans
                  orchestrate AI agents — connecting data, tools, and memory to
                  transform how organizations think, decide, and deliver value.
                </p>
              </div>

              <div className="inline-flex items-start gap-3 relative">
                <Button className="gap-2.5 px-[22px] py-4 bg-[#ccff00] hover:bg-[#b8e600] rounded-lg border border-solid border-black shadow-shadows-shadow-xs text-black font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                  Get in touch
                </Button>
              </div>
            </div>
          </div>

          <img
            className="relative max-w-screen-xl w-[536px] h-[518.63px] mb-[-3.63px]"
            alt="Container"
            src="/container-3.svg"
          />
        </div>
      </div>
      <SectionGridOverlay showCenterLine={false} />

      <SectionSeparator />

      <img
        className="absolute top-0 left-[calc(50.00%_-_720px)] w-[1440px] h-[837px] z-0"
        alt="Background pattern"
        src="/background-pattern.svg"
      />
    </section>
  );
};
