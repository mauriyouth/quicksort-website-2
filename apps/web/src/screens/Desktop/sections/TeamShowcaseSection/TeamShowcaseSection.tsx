import { useLocale } from '@lib/i18n';
import { useEffect, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";


gsap.registerPlugin(ScrollTrigger);

// Frames measured against the supplied 1344 × 1881 portrait previews.
// Keep the crown at ~7% and crown-to-chin height at ~42% of each card.
const portraitFrames: Record<string, { file: string; x: number; y: number; width: number; height: number }> = {
  "Issa Hammoud": { file: "issa-hammoud", x: 210, y: 160, width: 914, height: 1371 },
  "Nader Sadek": { file: "nader-sadek", x: 249, y: 139, width: 890, height: 1335 },
  "Dimitry Akulov": { file: "dimitry-akulov", x: 170, y: 45, width: 1000, height: 1500 },
  "Murad Mustafayev": { file: "murad", x: 279, y: 173, width: 834, height: 1251 },
  "Mohamed Ahmednah": { file: "mohamed", x: 208, y: 92, width: 971, height: 1457 },
  "Renaud Granier": { file: "renaud", x: 100, y: 168, width: 1140, height: 1710 },
  "Alexandra Beljakov": { file: "alexandra", x: 246, y: 133, width: 868, height: 1302 },
  "Mirette Moawad": { file: "mirette", x: 210, y: 93, width: 924, height: 1386 },
  "Amadou Ngam": { file: "amadou", x: 235, y: 105, width: 946, height: 1419 },
  "Aicha Dridi": { file: "aicha", x: 142, y: 43, width: 1016, height: 1524 },
  "Asmae Karmouchi": { file: "asmae", x: 196, y: 145, width: 914, height: 1371 },
  "Jermiah Jerome": { file: "jermiah", x: 208, y: 91, width: 946, height: 1419 },
};

const teamMembers = [
  {
    name: "Mohamed Ahmednah",
    role: "Founder, CTO",
    description:
      "Seasoned tech leader with deep expertise in AI systems and enterprise software architecture.",
    image: "/team/ahmednah-640.webp",
    imageSet: "/team/ahmednah-320.webp 320w, /team/ahmednah-640.webp 640w",
    imageWidth: 1452,
    imageHeight: 2579,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mohamed-ahmednah-19313116/",
  },
  {
    name: "Renaud Granier",
    role: "COO",
    description:
      "15+ years as a founder and executive, driving operations, growth, and secure AI transformation.",
    image: "/team/renaud-granier-640.webp",
    imageSet: "/team/renaud-granier-320.webp 320w, /team/renaud-granier-640.webp 640w",
    imageWidth: 800,
    imageHeight: 800,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/renaud-granier-8027788b/",
  },
  {
    name: "Alexandra Beljakov",
    role: "AI Strategist",
    description: "15+ years of experience in data and strategy, including at Mercedes and BNP Paribas. MBA, EDHEC.",
    linkedinUrl: "https://www.linkedin.com/in/alexandra-beljakov-0a8455203/",
    image: "/team/alexandra-beljakov-640.webp",
    imageSet: "/team/alexandra-beljakov-320.webp 320w, /team/alexandra-beljakov-640.webp 407w",
    imageWidth: 407,
    imageHeight: 480,
    hasArrow: false,
  },
  {
    name: "Mirette Moawad",
    role: "AI Researcher",
    description:
      "Specializes in NLP and large language models, driving cutting-edge research into production.",
    image: "/team/mirette-640.webp",
    imageSet: "/team/mirette-320.webp 320w, /team/mirette-640.webp 640w",
    imageWidth: 1452,
    imageHeight: 2579,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mirettemoawad/",
  },
  {
    name: "Amadou Ngam",
    role: "AI Engineer",
    description:
      "Full-stack AI engineer passionate about deploying scalable ML pipelines and infrastructure.",
    image: "/team/amadou-640.webp",
    imageSet: "/team/amadou-320.webp 320w, /team/amadou-640.webp 640w",
    imageWidth: 1452,
    imageHeight: 2579,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/amadoungam/",
  },
  {
    name: "Aicha Dridi",
    role: "AI Product Owner",
    description:
      "Bridges business strategy and technical execution, ensuring AI products deliver measurable impact.",
    image: "/team/dridi-640.webp",
    imageSet: "/team/dridi-320.webp 320w, /team/dridi-640.webp 640w",
    imageWidth: 1452,
    imageHeight: 2579,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/aicha-dridi/",
  },
  {
    name: "Jermiah Jerome",
    role: "Voice AI Engineer",
    description: "Voice AI engineer with 6+ years of experience, including work in regulated industries and at Foundever, delivering voice agents and bots for enterprise clients.",
    linkedinUrl: "https://www.linkedin.com/in/jermiah-jerome/",
    image: "/team/portraits/jermiah.JPG",
    imageSet: undefined,
    imageWidth: 1000,
    imageHeight: 1400,
    hasArrow: false,
  },
  {
    name: "Asmae Karmouchi",
    role: "AI Engineer",
    description:
      "Builds robust AI solutions and integrations, with a focus on reliability and performance.",
    image: "/team/asmae-karmouchi-640.webp",
    imageSet: "/team/asmae-karmouchi-320.webp 320w, /team/asmae-karmouchi-640.webp 407w",
    imageWidth: 407,
    imageHeight: 480,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/asmae-karmouchi-522769255/",
  },
  {
    name: "Murad Mustafayev",
    role: "AI Engineer",
    description:
      "Develops end-to-end AI systems, specializing in model optimization and deployment at scale.",
    image: "/team/murad-mustafayev-640.webp",
    imageSet: "/team/murad-mustafayev-320.webp 320w, /team/murad-mustafayev-640.webp 640w",
    imageWidth: 1070,
    imageHeight: 1470,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/murad-mustafayev/",
  },
  {
    name: "Nader Sadek",
    role: "Machine Learning Engineer",
    description: "Machine learning professional with R&D experience in graph neural networks and natural language processing.",
    image: "/team/portraits/nader-sadek.JPG",
    imageSet: undefined,
    imageWidth: 1000,
    imageHeight: 1400,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/sadek-nader/",
  },
  {
    name: "Dimitry Akulov",
    role: "AI Research Engineer",
    description: "",
    image: "/team/portraits/dimitry-akulov.JPG",
    imageSet: undefined,
    imageWidth: 1000,
    imageHeight: 1400,
    hasArrow: false,
  },
  {
    name: "Issa Hammoud",
    role: "Senior AI/ML Engineer",
    description: "",
    image: "/team/portraits/issa-hammoud.JPG",
    imageSet: undefined,
    imageWidth: 1000,
    imageHeight: 1400,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/issa-hammoud/",
  },
  {
    name: "Nageeta Kumari",
    role: "AI Engineer",
    description:
      "Focused on machine learning and computer vision, bridging academic research with real-world applications.",
    image: "/team/nageeta-640.webp",
    imageSet: "/team/nageeta-320.webp 320w, /team/nageeta-640.webp 640w",
    imageWidth: 1452,
    imageHeight: 2579,
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/nageeta124/",
  },
];

export const TeamShowcaseSection = (): JSX.Element => {
  const { t, localize, locale } = useLocale();
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
      className="relative flex flex-col items-center gap-8 sm:gap-12 md:gap-16 w-full bg-surface"
    >
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col items-center gap-8 sm:gap-12 md:gap-16 px-0 py-4 sm:py-6 md:py-8 w-full relative z-[1]">
        <div
          ref={headerRef}
          className="flex flex-col max-w-screen-xl items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0 w-full"
        >
          <div className="flex items-start justify-between gap-6 w-full">
            <div className="min-w-0 max-w-full sm:min-w-[480px] sm:max-w-screen-md gap-4 sm:gap-5 flex-1 grow flex flex-col items-start">
              <h2 className="mt-[-1.00px] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-ink [font-style:var(--display-md-semibold-font-style)]">{t("\n                We're a fast-growing team\n              ")}</h2>

              <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-ink-muted text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">{t("\n                We're always on the lookout for passionate, dynamic, and\n                talented individuals.\n              ")}</p>
            </div>

            <div className="hidden sm:inline-flex items-center gap-4 shrink-0 pt-1">
              <Button
                variant="outline"
                size="icon"
                onClick={scrollLeft}
                aria-label={t("Previous team members")}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-solid border-line bg-transparent hover:bg-surface-sunken"
              >
                <ChevronLeftIcon className="w-5 h-5 text-ink" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={scrollRight}
                aria-label={t("Next team members")}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-solid border-line bg-transparent hover:bg-surface-sunken"
              >
                <ChevronRightIcon className="w-5 h-5 text-ink" />
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
              {teamMembers.map((member) => {
                const frame = portraitFrames[member.name];
                return (
                <Card
                  key={member.name}
                  className="team-card group flex-shrink-0 w-[280px] sm:w-[300px] md:w-[320px] aspect-[2/3] border-0 rounded-lg overflow-hidden relative"
                >
                  <img
                    src={frame ? `/team/portraits/${frame.file}.JPG` : member.image}
                    srcSet={frame ? undefined : member.imageSet}
                    sizes="(min-width: 768px) 320px, (min-width: 640px) 300px, 280px"
                    width={member.imageWidth}
                    height={member.imageHeight}
                    loading="lazy"
                    decoding="async"
                    alt={t(member.name)}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={frame ? {
                      maxWidth: "none",
                      width: `${1344 / frame.width * 100}%`,
                      height: `${1881 / frame.height * 100}%`,
                      left: `${-frame.x / frame.width * 100}%`,
                      top: `${-frame.y / frame.height * 100}%`,
                    } : undefined}
                  />
                  <CardContent className="relative flex flex-col w-full h-full items-center justify-end p-0 z-10">
                    {/* Overlay container, anchored to bottom, slides up on hover */}
                    <div
                      className="absolute bottom-0 left-0 right-0 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] translate-y-[calc(100%-230px)] sm:translate-y-[calc(100%-250px)] group-hover:translate-y-0"
                    >
                      {/* Gradient fade above the content */}
                      <div className="h-16 sm:h-20 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />

                      {/* Content panel */}
                      <div className="flex flex-col items-start min-h-[166px] sm:min-h-[170px] gap-4 sm:gap-5 pt-4 sm:pt-5 pb-5 sm:pb-6 px-4 sm:px-6 w-full bg-photo-scrim border-t [border-top-style:solid] backdrop-blur-md backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(12px)_brightness(100%)]">
                        {/* Name */}
                        <h3 className="font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-on-fill text-lg sm:text-xl md:text-2xl tracking-[var(--display-sm-semibold-letter-spacing)] leading-[1.2] [font-style:var(--display-sm-semibold-font-style)]">
                          {t(member.name)}
                        </h3>

                        {/* Role */}
                        {member.role && <div className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-on-fill/70 text-sm sm:text-base md:text-lg tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                          {t(member.role)}
                        </div>}

                        {/* Description, only visible when hovered */}
                        {member.description && (
                          <p className="text-on-fill/85 text-sm sm:text-base leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                            {t(member.description)}
                          </p>
                        )}

                        {/* LinkedIn */}
                        {member.linkedinUrl && (
                          <div className="flex items-center gap-4 sm:gap-5 w-full pt-1">
                            <a
                              href={localize(member.linkedinUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:opacity-80 transition-opacity"
                            >
                              <img
                                className="w-5 h-5 sm:w-6 sm:h-6"
                                alt={t("LinkedIn")}
                                src="/social-icon-1.svg"
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );})}
            </div>
          </div>
        </div>
      </div>
      <SectionSeparator />
    </section>
  );
};
