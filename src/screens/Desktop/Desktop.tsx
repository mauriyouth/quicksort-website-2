import { DetailedCapabilitiesSection } from "./sections/DetailedCapabilitiesSection";
import { FooterSection } from "./sections/FooterSection";
import { HeroIntroSection } from "./sections/HeroIntroSection";
import { KeyFeaturesSection } from "./sections/KeyFeaturesSection";
import { TeamShowcaseSection } from "./sections/TeamShowcaseSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";

export const Desktop = (): JSX.Element => {
  return (
    <main className="flex flex-col w-full items-center relative bg-[#141414]">
      <MainNavigationSection />
      <HeroIntroSection />

      <KeyFeaturesSection />

      <DetailedCapabilitiesSection />

      <TeamShowcaseSection />

      <FooterSection />
    </main>
  );
};
