import { DataOverviewSection } from "./sections/DataOverviewSection";
import { IntelligenceFeaturesSection } from "./sections/IntelligenceFeaturesSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { SiteFooterSection } from "../../components/SiteFooterSection";

export const DataForAi = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />

      <IntelligenceFeaturesSection />

      <DataOverviewSection />

      <SiteFooterSection />

      <img
        className="absolute top-0 left-[90px] w-[1260px] h-[945px] pointer-events-none"
        alt="Background pattern"
        src="/background-pattern.svg"
      />
    </div>
  );
};
