export const CareersIntroSection = (): JSX.Element => {
  return (
    <section className="gap-8 sm:gap-12 md:gap-16 px-0 pt-12 sm:pt-16 md:pt-24 pb-0 self-stretch flex-[0_0_auto] flex flex-col w-full items-center">
      <div className="flex flex-col max-w-screen-xl items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0 w-full flex-[0_0_auto]">
        <div className="flex flex-col items-start gap-8 sm:gap-10 md:gap-12 self-stretch w-full flex-[0_0_auto]">
          <div className="flex flex-col max-w-screen-md items-start gap-4 sm:gap-6 w-full flex-[0_0_auto]">
            <div className="flex-col gap-3 flex items-start self-stretch w-full flex-[0_0_auto]">
              <div className="text-[#ccff00] text-sm sm:text-[length:var(--text-md-semibold-font-size)] leading-[var(--text-md-semibold-line-height)] self-stretch mt-[-1.00px] font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] tracking-[var(--text-md-semibold-letter-spacing)] [font-style:var(--text-md-semibold-font-style)]">
                Careers
              </div>

              <h1 className="self-stretch font-display-lg-semibold font-[number:var(--display-lg-semibold-font-weight)] text-[#f5f5f6] text-3xl sm:text-4xl md:text-5xl lg:text-[length:var(--display-lg-semibold-font-size)] tracking-[var(--display-lg-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-lg-semibold-line-height)] [font-style:var(--display-lg-semibold-font-style)]">
                We're building the future of human-AI collaboration
              </h1>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
