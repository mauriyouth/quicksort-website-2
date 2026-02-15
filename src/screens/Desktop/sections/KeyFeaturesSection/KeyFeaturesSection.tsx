import { useEffect, useRef } from "react";
import { Card, CardContent } from "@components/ui/card";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    title: "Enterprise AI Implementation",
    description:
      "Production AI agents and copilots for complex business environments. Banking, finance, regulated industries, where reliability and security aren't negotiable.",
  },
  {
    title: "Full-Stack AI Development",
    description:
      "Agentic architectures to user interfaces, complete solutions. AI orchestration, data pipelines, infrastructure, frontend experiences. Unified systems built for human-AI collaboration.",
  },
  {
    title: "Engineering-First Approach",
    description:
      "We don't just advise on AI strategy, we implement it. Real engineering expertise. Cloud-native or on-premise. Whatever your security requirements demand.",
  },
  {
    title: "Trusted by Regulated Industries",
    description:
      "Major banks. Aerospace. Industrial leaders. We understand compliance constraints, data governance, and the rigor required when AI mistakes have consequences.",
  },
];

export const KeyFeaturesSection = (): JSX.Element => {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current || !headerRef.current || !cardsRef.current) return;

    const ctx = gsap.context(() => {
      // Header slides in from the left
      gsap.from(headerRef.current, {
        x: -60,
        opacity: 0,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: headerRef.current,
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      });

      // Feature cards stagger up from below
      const cards = cardsRef.current?.querySelectorAll(".feature-card");
      if (cards && cards.length > 0) {
        gsap.set(cards, { y: 60, opacity: 0 });
        gsap.to(cards, {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: cardsRef.current,
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        });
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative flex flex-col items-center gap-8 sm:gap-12 md:gap-16 px-0 py-4 sm:py-6 md:py-8 w-full bg-[#141414]"
    >
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col lg:flex-row max-w-screen-xl items-start gap-8 sm:gap-12 lg:gap-16 px-4 sm:px-8 py-0 w-full relative z-[1]">
        <div
          ref={headerRef}
          className="max-w-full lg:max-w-[360px] gap-5 flex-1 grow flex flex-col items-start w-full lg:w-auto"
        >
          <div className="flex flex-col items-start gap-5 w-full">
            <div className="relative w-14 h-[52px] shrink-0">
              <div className="absolute top-0 left-0 w-[51px] h-[51px] bg-neutral-50 rounded-[25.33px]" />
              <div className="absolute top-[18px] left-[30px] w-[17px] h-[34px] bg-[#141414] rounded-[34.62px] rotate-[-47.64deg]" />
              <div className="absolute top-8 left-9 w-[17px] h-[17px] bg-neutral-50 rounded-[8.55px]" />
            </div>

            <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
              Why Quicksort is Different
            </h2>
          </div>

          <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
            We blend deep AI research, product design, and infrastructure
            engineering into a single craft.
          </p>
        </div>

        <div
          ref={cardsRef}
          className="flex flex-col sm:grid sm:grid-cols-2 items-start justify-center gap-6 sm:gap-8 lg:gap-[32px_64px] flex-1 grow w-full"
        >
          {features.map((feature, index) => (
            <Card
              key={index}
              className="feature-card flex min-w-0 sm:min-w-[280px] lg:min-w-80 max-w-full sm:max-w-none lg:max-w-[480px] items-start gap-4 flex-1 grow border-0 bg-transparent shadow-none"
            >
              <CardContent className="flex flex-col items-start gap-5 flex-1 grow p-0">
                <div className="flex flex-col items-start gap-2 w-full">
                  <h3 className="mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-lg sm:text-xl md:text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                    {feature.title}
                  </h3>

                  <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                    {feature.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <SectionSeparator />
    </section>
  );
};
