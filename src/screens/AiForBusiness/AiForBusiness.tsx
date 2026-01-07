import { BusinessOverviewSection } from "./sections/BusinessOverviewSection";
import { IntelligentWorkAdoptionSection } from "./sections/IntelligentWorkAdoptionSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { SiteFooterSection } from "../../components/SiteFooterSection";

export const AiForBusiness = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <img
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1260px] h-[945px] pointer-events-none"
        alt="Background pattern"
        src="/background-pattern.svg"
      />

      <MainNavigationSection />

      <IntelligentWorkAdoptionSection />

      <BusinessOverviewSection />

      <SiteFooterSection />
    </div>
  );
};
