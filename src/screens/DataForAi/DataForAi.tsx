import { DataOverviewSection } from "./sections/DataOverviewSection";
import { IntelligenceFeaturesSection } from "./sections/IntelligenceFeaturesSection";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

export const DataForAi = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />

      <IntelligenceFeaturesSection />

      <DataOverviewSection />

      <SiteFooter />
    </div>
  );
};
