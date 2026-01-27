import { CareersIntroSection } from "./sections/CareersIntroSection";
import { JobListingsSection } from "./sections/JobListingsSection";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

export const Carreer = (): JSX.Element => {
  return (
    <main className="flex flex-col w-full items-center relative bg-[#141414] overflow-x-hidden">
      <img
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none"
        alt="Background pattern"
        src="/background-pattern.svg"
      />

      <MainNavigationSection />
      <CareersIntroSection />
      <JobListingsSection />
      <SiteFooter />
    </main>
  );
};
