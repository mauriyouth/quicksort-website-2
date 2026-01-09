export const CareersIntroSection = (): JSX.Element => {
  return (
    <div className="relative self-stretch w-full flex flex-col items-center pt-12 sm:pt-16 md:pt-20">
      <div className="flex max-w-screen-xl items-center justify-between px-4 sm:px-8 py-0 relative w-full flex-[0_0_auto]">
        <div className="flex flex-col items-start gap-8 sm:gap-10 md:gap-12 relative flex-1 grow w-full">
          <div className="flex flex-col items-start gap-4 sm:gap-6 relative self-stretch w-full">
            <h1 className="mt-[-1.00px] [font-family:'Hanken_Grotesk',Helvetica] font-medium text-neutral-50 text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-[-1.20px] leading-[1.2] sm:leading-[56px] lg:leading-[72px] relative self-stretch">
              Careers at Quicksort
            </h1>
            <p className="relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
              Helping businesses build the next generation of AI
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
