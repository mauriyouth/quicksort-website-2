import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent } from "../../../../components/ui/card";
import { SectionGridOverlay } from "../../../../components/SectionGridOverlay";
import { SectionSeparator } from "../../../../components/SectionSeparator";

const teamMembers = [
  {
    name: "Mohamed Ahmednah",
    role: "Founder, CTO",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mohamed-ahmednah-19313116/",
  },
  {
    name: "Mirette Moawad",
    role: "AI Researcher",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-1.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mirettemoawad/",
  },
  {
    name: "Nageeta Kumari",
    role: "AI Researcher",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-2.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/nageeta124/",
  },
  {
    name: "Mohamed Benyahia",
    role: "AI Researcher",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-3.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/mohamed-benyahia-3171b7252/",
  },
  {
    name: "Amadou Ngam",
    role: "AI Engineer",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-4.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/amadoungam/",
  },
  {
    name: "Aicha Dridi",
    role: "AI Product Owner",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-5.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/aicha-dridi/",
  },
  {
    name: "Adel Benz",
    role: "AI Product Designer",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-6.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/adel-benzehda/",
  },
  {
    name: "Asame Karmouchi",
    role: "AI Engineer",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-7.png",
    hasArrow: false,
    linkedinUrl: "https://www.linkedin.com/in/asmae-karmouchi-522769255/",
  },
];

export const TeamShowcaseSection = (): JSX.Element => {
  const carouselRef = useRef<HTMLDivElement>(null);

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

  return (
    <section className="relative flex flex-col items-center gap-8 sm:gap-12 md:gap-16 w-full bg-[#141414]">
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col items-center gap-8 sm:gap-12 md:gap-16 px-0 py-12 sm:py-16 md:py-24 w-full relative z-[1]">
        <div className="flex flex-col max-w-screen-xl items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0 w-full">
          <div className="flex flex-wrap items-start justify-between gap-[32px_0px] w-full">
            <div className="min-w-0 max-w-full sm:min-w-[480px] sm:max-w-screen-md gap-4 sm:gap-5 flex-1 grow flex flex-col items-start w-full">
              <h2 className="mt-[-1.00px] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                We&apos;re a fast-growing team
              </h2>

              <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                We&apos;re always on the lookout for passionate, dynamic, and
                talented individuals.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col w-full items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0">
          <div className="inline-flex flex-col items-start gap-6 sm:gap-8 w-full">
            <div
              ref={carouselRef}
              className="flex w-full items-start gap-4 sm:gap-6 md:gap-8 overflow-x-auto scroll-smooth scrollbar-hide"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {teamMembers.map((member, index) => (
                <Card
                  key={index}
                  className="flex-shrink-0 w-[280px] sm:w-[300px] md:w-[320px] h-[400px] sm:h-[450px] md:h-[480px] border-0 rounded-lg overflow-hidden relative"
                >
                  <img
                    src={member.image}
                    alt={member.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <CardContent className="relative flex flex-col w-full h-full items-center justify-end p-0 z-10">
                    <div className="flex flex-col w-full items-center justify-center pt-16 sm:pt-20 md:pt-24 pb-0 px-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.6)_100%)]">
                      <div className="flex flex-col items-start gap-4 sm:gap-6 md:gap-8 pt-4 sm:pt-6 pb-6 sm:pb-8 px-4 sm:px-6 w-full bg-[#0c111d4c] border-t [border-top-style:solid] backdrop-blur-md backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(12px)_brightness(100%)] shadow-backdrop-blurs-backdrop-blur-lg">
                        <div className="flex flex-col items-start gap-3 sm:gap-4 w-full">
                          <div className="gap-3 sm:gap-4 flex items-start w-full">
                            <h3 className="flex-1 mt-[-1.00px] font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-white text-xl sm:text-2xl md:text-[length:var(--display-sm-semibold-font-size)] tracking-[var(--display-sm-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-sm-semibold-line-height)] [font-style:var(--display-sm-semibold-font-style)]">
                              {member.name}
                            </h3>

                            {member.hasArrow && (
                              <div className="inline-flex flex-col items-start pt-1.5 pb-0 px-0 shrink-0">
                                <img
                                  className="w-5 h-5 sm:w-6 sm:h-6"
                                  alt="Arrow up right"
                                  src="/arrow-up-right.svg"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-start gap-1 w-full">
                            <div className="mt-[-1.00px] font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-white text-base sm:text-lg md:text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                              {member.role}
                            </div>

                            <p className="text-white font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                              {member.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 sm:gap-5 w-full">
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

            <div className="inline-flex items-start gap-4 sm:gap-6 md:gap-8 self-center sm:self-start">
              <Button
                variant="outline"
                size="icon"
                onClick={scrollLeft}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronLeftIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={scrollRight}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronRightIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <SectionSeparator />
    </section>
  );
};
