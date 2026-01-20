import { InfrastructureOverviewSection } from "./sections/InfrastructureOverviewSection";
import { ProductionDesignFeaturesSection } from "./sections/ProductionDesignFeaturesSection";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

export const InfrastructureFor = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />
      <ProductionDesignFeaturesSection />
      <InfrastructureOverviewSection />
      <SiteFooter />
    </div>
  );
};
