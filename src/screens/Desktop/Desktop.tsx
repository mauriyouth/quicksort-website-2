import { DetailedCapabilitiesSection } from "./sections/DetailedCapabilitiesSection";
import { FooterSection } from "./sections/FooterSection";
import { HeroIntroSection } from "./sections/HeroIntroSection";
import { KeyFeaturesSection } from "./sections/KeyFeaturesSection";
import { TeamShowcaseSection } from "./sections/TeamShowcaseSection";

export const Desktop = (): JSX.Element => {
  return (
    <main className="flex flex-col w-full max-w-[1440px] mx-auto items-center relative bg-[#141414]">
      <HeroIntroSection />

      <KeyFeaturesSection />

      <DetailedCapabilitiesSection />

      <TeamShowcaseSection />

      <FooterSection />
    </main>
  );
};
