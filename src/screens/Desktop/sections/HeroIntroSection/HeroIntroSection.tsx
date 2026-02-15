import { useEffect, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";

import { ScrambleTextOnHover } from "@components/ScrambleText";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);



export const HeroIntroSection = (): JSX.Element => {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const [isHovered, setIsHovered] = useState(false);

  const handleHeadingHover = () => {
    setIsHovered(true);
  };

  const handleHeadingLeave = () => {
    setIsHovered(false);
  };

  useEffect(() => {
    if (!sectionRef.current || !contentRef.current) return;

    const ctx = gsap.context(() => {
      // Staggered entrance animation
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      tl.from(headingRef.current, {
        y: 60,
        opacity: 0,
        duration: 1,
        delay: 0.2,
      })
        .from(
          subtitleRef.current,
          {
            y: 40,
            opacity: 0,
            duration: 0.8,
          },
          "-=0.5"
        )
        .from(
          ctaRef.current,
          {
            y: 30,
            opacity: 0,
            duration: 0.6,
          },
          "-=0.4"
        )
        .from(
          imageRef.current,
          {
            x: 80,
            opacity: 0,
            duration: 1,
          },
          "-=0.8"
        );

      // Parallax scroll-out: content fades up as user scrolls past hero
      gsap.to(contentRef.current, {
        y: -100,
        opacity: 0,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="flex flex-col items-center relative w-full bg-[#141414] overflow-hidden"
    >


      <div
        ref={contentRef}
        className="min-h-[757px] px-0 py-4 sm:py-6 md:py-8 z-[1] flex items-start justify-center relative w-full"
      >
        <div className="flex flex-col lg:flex-row max-w-screen-xl w-full items-center justify-between relative gap-8 lg:gap-0">
          <div className="flex max-w-screen-xl items-end gap-8 px-4 sm:px-8 py-0 relative flex-1 grow w-full">
            <div className="flex flex-col items-start gap-8 sm:gap-12 relative flex-1 self-stretch grow w-full">
              <div className="flex flex-col max-w-screen-lg items-start gap-4 sm:gap-6 relative w-full">
                <h1
                  ref={headingRef}
                  className="mt-[-1.00px] [font-family:'Hanken_Grotesk',Helvetica] font-medium text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-[-1.20px] leading-[1.2] sm:leading-[56px] lg:leading-[72px] relative self-stretch text-[#f5f5f6]"
                >
                  We Craft{" "}
                  <span
                    className="relative inline-block cursor-pointer"
                    onMouseEnter={handleHeadingHover}
                    onMouseLeave={handleHeadingLeave}
                  >
                    {/* Accent background rectangle — scales in on hover */}
                    <span
                      className="absolute bg-[#ccff00]"
                      style={{
                        left: "-0.15em",
                        right: "-0.15em",
                        top: "0.05em",
                        bottom: "0.05em",
                        transform: isHovered ? "scaleX(1)" : "scaleX(0)",
                        transformOrigin: "left center",
                        transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    />
                    <span
                      className="relative z-10"
                      style={{
                        color: isHovered ? "#000000" : "#f5f5f6",
                        transition: "color 0.3s ease 0.1s",
                      }}
                    >
                      <ScrambleTextOnHover
                        text="Human + AI"
                        duration={1.4}
                      />
                    </span>
                  </span>{" "}
                  Collaboration.
                </h1>

                <p
                  ref={subtitleRef}
                  className="relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]"
                >
                  We design and engineer agentic systems where humans
                  orchestrate AI agents — connecting data, tools, and memory to
                  transform how organizations think, decide, and deliver value.
                </p>
              </div>

              <div ref={ctaRef} className="inline-flex items-start gap-3 relative">
                <a href="mailto:hello@quicksort.fr">
                  <Button className="group gap-2.5 px-5 sm:px-[22px] py-3 sm:py-4 bg-[#ccff00] hover:bg-[#b8e600] rounded-lg border border-solid border-black shadow-shadows-shadow-xs text-black font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-sm sm:text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                    Get in touch
                  </Button>
                </a>
              </div>
            </div>
          </div>

          <div ref={imageRef} className="flex items-center justify-center w-full lg:w-auto">
            <img
              className="relative max-w-full w-full sm:w-[400px] md:w-[500px] lg:w-[536px] h-auto lg:h-[518.63px] mb-[-3.63px]"
              alt="Container"
              src="/container-3.svg"
            />
          </div>
        </div>
      </div>
      <SectionGridOverlay showCenterLine={false} />

      <SectionSeparator />

      <img
        className="hidden lg:block absolute top-0 left-[calc(50.00%_-_720px)] w-[1440px] h-[837px] z-0"
        alt="Background pattern"
        src="/background-pattern.svg"
      />
      <img
        className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-auto z-0 opacity-50"
        alt="Background pattern"
        src="/background-pattern.svg"
      />
    </section>
  );
};
