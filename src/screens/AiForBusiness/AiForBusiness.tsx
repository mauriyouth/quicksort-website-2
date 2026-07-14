import { BusinessOverviewSection } from "./sections/BusinessOverviewSection";
import { IntelligentWorkAdoptionSection } from "./sections/IntelligentWorkAdoptionSection";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

export const AiForBusiness = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-ink overflow-x-hidden">
      <MainNavigationSection />

      <IntelligentWorkAdoptionSection />

      <BusinessOverviewSection />

      <SiteFooter />
    </div>
  );
};
