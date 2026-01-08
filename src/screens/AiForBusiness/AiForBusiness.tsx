import { BusinessOverviewSection } from "./sections/BusinessOverviewSection";
import { IntelligentWorkAdoptionSection } from "./sections/IntelligentWorkAdoptionSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { SiteFooterSection } from "../../components/SiteFooterSection";

export const AiForBusiness = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />

      <IntelligentWorkAdoptionSection />

      <BusinessOverviewSection />

      <SiteFooterSection />
    </div>
  );
};
