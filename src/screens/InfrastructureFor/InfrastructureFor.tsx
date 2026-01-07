import { InfrastructureOverviewSection } from "./sections/InfrastructureOverviewSection";
import { ProductionDesignFeaturesSection } from "./sections/ProductionDesignFeaturesSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { SiteFooterSection } from "../../components/SiteFooterSection";

export const InfrastructureFor = (): JSX.Element => {
  return (
    <div className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />
      <ProductionDesignFeaturesSection />
      <InfrastructureOverviewSection />
      <SiteFooterSection />
    </div>
  );
};
