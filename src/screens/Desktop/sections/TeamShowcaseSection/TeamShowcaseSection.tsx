import { useEffect, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const teamMembers = [
  {
    name: "Mohamed Ahmednah",
    role: "Founder, CTO",
    description:
      "Seasoned tech leader with deep expertise in AI systems and enterprise software architecture.",
    image: "/ahmednah.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mohamed-ahmednah-19313116/",
  },
  {
    name: "Mirette Moawad",
    role: "AI Researcher",
    description:
      "Specializes in NLP and large language models, driving cutting-edge research into production.",
    image: "/mirette.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mirettemoawad/",
  },
  {
    name: "Nageeta Kumari",
    role: "AI Engineer",
    description:
      "Focused on machine learning and computer vision, bridging academic research with real-world applications.",
    image: "/nageeta.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/nageeta124/",
  },
  {
    name: "Mohamed Benyahia",
    role: "AI Researcher",
    description:
      "Expert in deep learning and generative AI, building intelligent solutions for complex problems.",
    image: "/benyahia.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mohamed-benyahia-3171b7252/",
  },
  {
    name: "Amadou Ngam",
    role: "AI Engineer",
    description:
      "Full-stack AI engineer passionate about deploying scalable ML pipelines and infrastructure.",
    image: "/amadou.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/amadoungam/",
  },
  {
    name: "Aicha Dridi",
    role: "AI Product Owner",
    description:
      "Bridges business strategy and technical execution, ensuring AI products deliver measurable impact.",
    image: "/dridi.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/aicha-dridi/",
  },
  {
    name: "Adel Benz",
    role: "AI Product Designer",
    description:
      "Crafts intuitive user experiences for AI-powered products, blending design thinking with technology.",
    image: "/adel.webp",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/adel-benzehda/",
  },
  {
    name: "Asame Karmouchi",
    role: "AI Engineer",
    description:
      "Builds robust AI solutions and integrations, with a focus on reliability and performance.",
    image: "..//-team-member-7.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/asmae-karmouchi-522769255/",
  },
  {
    name: "Murad Mustafayev",
    role: "AI Engineer",
    description:
      "Develops end-to-end AI systems, specializing in model optimization and deployment at scale.",
    image: "..//-team-member-8.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/murad-mustafayev/",
  },
];

export const TeamShowcaseSection = (): JSX.Element => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  const scrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -340, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: 340, behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (!sectionRef.current || !headerRef.current || !cardsContainerRef.current) return;

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

      // Team cards stagger up from below
      const cards = cardsContainerRef.current?.querySelectorAll(".team-card");
      if (cards && cards.length > 0) {
        gsap.set(cards, { y: 60, opacity: 0 });
        gsap.to(cards, {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: cardsContainerRef.current,
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
      className="relative flex flex-col items-center gap-8 sm:gap-12 md:gap-16 w-full bg-[#141414]"
    >
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col items-center gap-8 sm:gap-12 md:gap-16 px-0 py-4 sm:py-6 md:py-8 w-full relative z-[1]">
        <div
          ref={headerRef}
          className="flex flex-col max-w-screen-xl items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0 w-full"
        >
          <div className="flex items-start justify-between gap-6 w-full">
            <div className="min-w-0 max-w-full sm:min-w-[480px] sm:max-w-screen-md gap-4 sm:gap-5 flex-1 grow flex flex-col items-start">
              <h2 className="mt-[-1.00px] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                We&apos;re a fast-growing team
              </h2>

              <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                We&apos;re always on the lookout for passionate, dynamic, and
                talented individuals.
              </p>
            </div>

            <div className="hidden sm:inline-flex items-center gap-4 shrink-0 pt-1">
              <Button
                variant="outline"
                size="icon"
                onClick={scrollLeft}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronLeftIcon className="w-5 h-5 text-white" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={scrollRight}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronRightIcon className="w-5 h-5 text-white" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col w-full items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0">
          <div className="inline-flex flex-col items-start gap-6 sm:gap-8 w-full">
            <div
              ref={(el) => {
                carouselRef.current = el;
                cardsContainerRef.current = el;
              }}
              className="flex w-full items-start gap-4 sm:gap-6 md:gap-8 overflow-x-auto scroll-smooth scrollbar-hide"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {teamMembers.map((member, index) => (
                <Card
                  key={index}
                  className="team-card group flex-shrink-0 w-[280px] sm:w-[300px] md:w-[320px] h-[400px] sm:h-[450px] md:h-[480px] border-0 rounded-lg overflow-hidden relative"
                >
                  <img
                    src={member.image}
                    alt={member.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <CardContent className="relative flex flex-col w-full h-full items-center justify-end p-0 z-10">
                    {/* Overlay container — anchored to bottom, slides up on hover */}
                    <div
                      className="absolute bottom-0 left-0 right-0 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] translate-y-[calc(100%-230px)] sm:translate-y-[calc(100%-250px)] group-hover:translate-y-0"
                    >
                      {/* Gradient fade above the content */}
                      <div className="h-16 sm:h-20 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />

                      {/* Content panel */}
                      <div className="flex flex-col items-start gap-4 sm:gap-5 pt-4 sm:pt-5 pb-5 sm:pb-6 px-4 sm:px-6 w-full bg-[#0c111d99] border-t [border-top-style:solid] backdrop-blur-md backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(12px)_brightness(100%)]">
                        {/* Name */}
                        <h3 className="font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-white text-lg sm:text-xl md:text-2xl tracking-[var(--display-sm-semibold-letter-spacing)] leading-[1.2] [font-style:var(--display-sm-semibold-font-style)]">
                          {member.name}
                        </h3>

                        {/* Role */}
                        <div className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[#b0b3ba] text-sm sm:text-base md:text-lg tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                          {member.role}
                        </div>

                        {/* Description — only visible when hovered */}
                        {member.description && (
                          <p className="text-[#d0d5dd] text-sm sm:text-base leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                            {member.description}
                          </p>
                        )}

                        {/* LinkedIn */}
                        <div className="flex items-center gap-4 sm:gap-5 w-full pt-1">
                          <a
                            href={member.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-80 transition-opacity"
                          >
                            <img
                              className="w-5 h-5 sm:w-6 sm:h-6"
                              alt="LinkedIn"
                              src="/social-icon-1.svg"
                            />
                          </a>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
      <SectionSeparator />
    </section>
  );
};
