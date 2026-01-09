import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent } from "../../../../components/ui/card";
import { SectionGridOverlay } from "../../../../components/SectionGridOverlay";
import { SectionSeparator } from "../../../../components/SectionSeparator";

const teamMembers = [
  {
    name: "Mohamed Ahmednah",
    role: "Engineering Manager",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member.png",
    hasArrow: false,
    socialIcons: ["/social-icon.svg", "/social-icon-1.svg"],
  },
  {
    name: "Mohamed Ahmednah",
    role: "Founder & CTO",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-1.png",
    hasArrow: false,
    socialIcons: ["/social-icon.svg", "/social-icon-1.svg"],
  },
  {
    name: "Annie Stanley",
    role: "Product Manager",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-2.png",
    hasArrow: false,
    socialIcons: ["/social-icon.svg", "/social-icon-1.svg"],
  },
  {
    name: "Johnny Bell",
    role: "Frontend Developer",
    description: "Former co-founder of Quicksort.",
    image: "..//-team-member-3.png",
    hasArrow: true,
    socialIcons: [
      "/social-icon.svg",
      "/social-icon-1.svg",
      "/social-icon-2.svg",
    ],
  },
  {
    name: "Mia Ward",
    role: "Backend Developer",
    description: "Lead backend dev at Clearbit. Former Clearbit and Loom.",
    image: "..//-team-member-4.png",
    hasArrow: true,
    socialIcons: [
      "/social-icon.svg",
      "/social-icon-1.svg",
      "/social-icon-2.svg",
    ],
  },
  {
    name: "Archie Young",
    role: "Product Designer",
    description:
      "Founding design team at Figma. Former Pleo, Stripe, and Tile.",
    image: "..//-team-member-5.png",
    hasArrow: true,
    socialIcons: [
      "/social-icon.svg",
      "/social-icon-1.svg",
      "/social-icon-2.svg",
    ],
  },
];

export const TeamShowcaseSection = (): JSX.Element => {
  return (
    <section className="relative flex flex-col items-center gap-16 w-full bg-[#141414]">
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col items-center gap-16 px-0 py-24 w-full relative z-[1]">
        <div className="flex flex-col max-w-screen-xl items-start gap-8 px-8 py-0 w-full">
          <div className="flex flex-wrap items-start justify-between gap-[32px_0px] w-full">
            <div className="min-w-[480px] max-w-screen-md gap-5 flex-1 grow flex flex-col items-start">
              <h2 className="mt-[-1.00px] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                We&apos;re a fast-growing team
              </h2>

              <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                We&apos;re always on the lookout for passionate, dynamic, and
                talented individuals.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col max-w-screen-xl items-start gap-8 px-8 py-0 w-full">
          <div className="inline-flex flex-col items-start gap-8 w-full overflow-hidden">
            <div className="flex w-[2464px] items-start gap-8">
              {teamMembers.map((member, index) => (
                <Card
                  key={index}
                  className="flex-1 h-[480px] border-0 rounded-none overflow-hidden bg-cover bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${member.image})` }}
                >
                  <CardContent className="flex flex-col w-full h-full items-center justify-end p-0">
                    <div className="flex flex-col w-full items-center justify-center pt-24 pb-0 px-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.4)_100%)]">
                      <div className="flex flex-col items-start gap-8 pt-6 pb-8 px-6 w-full bg-[#0c111d4c] border-t [border-top-style:solid] backdrop-blur-md backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(12px)_brightness(100%)] shadow-backdrop-blurs-backdrop-blur-lg">
                        <div className="flex flex-col items-start gap-4 w-full">
                          <div className="gap-4 flex items-start w-full">
                            <h3 className="flex-1 mt-[-1.00px] font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-white text-[length:var(--display-sm-semibold-font-size)] tracking-[var(--display-sm-semibold-letter-spacing)] leading-[var(--display-sm-semibold-line-height)] [font-style:var(--display-sm-semibold-font-style)]">
                              {member.name}
                            </h3>

                            {member.hasArrow && (
                              <div className="inline-flex flex-col items-start pt-1.5 pb-0 px-0">
                                <img
                                  className="w-6 h-6"
                                  alt="Arrow up right"
                                  src="/arrow-up-right.svg"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-start gap-1 w-full">
                            <div className="mt-[-1.00px] font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-white text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                              {member.role}
                            </div>

                            <p className="text-white font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                              {member.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-5 w-full">
                          {member.socialIcons.map((icon, iconIndex) => (
                            <img
                              key={iconIndex}
                              className="w-6 h-6"
                              alt="Social icon"
                              src={icon}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="inline-flex items-start gap-8">
              <Button
                variant="outline"
                size="icon"
                className="w-14 h-14 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronLeftIcon className="w-6 h-6 text-white" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="w-14 h-14 rounded-full border border-solid border-[#1f242f] bg-transparent hover:bg-[#1f242f]"
              >
                <ChevronRightIcon className="w-6 h-6 text-white" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <SectionSeparator />
    </section>
  );
};
