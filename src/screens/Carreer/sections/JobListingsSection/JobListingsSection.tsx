import { Link } from "react-router-dom";
import { ArrowUpRightIcon, ClockIcon, MapPinIcon } from "lucide-react";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";

const jobListings = [
  {
    slug: "senior-ai-ml-engineer",
    title: "Senior AI & ML Engineer",
    category: "Engineering",
    categoryColor: {
      bg: "bg-[#4e0d30]",
      border: "border-[#9e155e]",
      dot: "bg-[#ed46bb]",
      text: "text-[#f9a7df]",
    },
    description: "Design and deploy autonomous AI agents that transform our clients' business processes. 5+ years experience, €60-90K based on profile.",
    location: "Paris",
    type: "Permanent (CDI)",
  },
];

const teamImages = [
  {
    position: "top-0 left-[calc(50.00%_+_8px)]",
    size: "w-40 h-60",
    style: "[background:url(..//image.png)_50%_50%_/_cover]",
  },
  {
    position: "top-64 left-[calc(50.00%_+_96px)]",
    size: "w-48 h-44",
    style:
      "bg-[url(/image-2.svg)] bg-cover bg-[50%_50%] bg-avatar-user-squarelily-rose-chedjou-neutral-background",
  },
  {
    position: "top-64 left-[calc(50.00%_-_288px)]",
    size: "w-48 h-48",
    style:
      "bg-[url(/image-3.svg)] bg-cover bg-[50%_50%] bg-avatar-user-squarelevi-rocha-neutral-background",
  },
  {
    position: "top-64 left-[calc(50.00%_-_80px)]",
    size: "w-40 h-60",
    style: "[background:url(..//image-1.png)_50%_50%_/_cover]",
  },
  {
    position: "top-20 left-[calc(50.00%_-_168px)]",
    size: "w-40 h-40",
    style:
      "bg-[url(/image-4.svg)] bg-cover bg-[50%_50%] bg-avatar-user-squareamlie-laurent-neutral-background",
  },
];

export const JobListingsSection = (): JSX.Element => {
  return (
    <section className="flex flex-col items-center w-full">
      <div className="flex flex-col items-center justify-center gap-16 pt-24 pb-0 px-0 w-full">
        <div className="flex flex-wrap max-w-screen-xl items-center justify-center gap-16 px-8 py-0 w-full">
          <div className="flex flex-col min-w-[480px] items-start gap-8 flex-1 grow">
            <div className="flex flex-col max-w-screen-md items-start gap-5 w-full">


              <div className="flex flex-col items-start gap-5">

                <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  Quicksort is an AI services firm based in Paris, working with major enterprises across banking, aerospace, utilities, and hospitality. We don&apos;t just implement AI; we fundamentally transform how organizations leverage intelligent systems to amplify human capability.
                </p>

                <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  Our philosophy is grounded in a simple equation: <span className="text-[#ccff00] font-semibold">Human + AI = Compound Value</span>. We believe the future isn&apos;t about AI replacing people, but about collaborative systems that make teams more effective, decisions more informed, and businesses more resilient.
                </p>

                <div className="mt-4">
                  <h4 className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] mb-3">
                    What we do
                  </h4>
                  <p className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)] mb-3">
                    We partner with C-level executives and technical leaders to design and implement AI transformation strategies that actually work. Our focus is on:
                  </p>
                  <ul className="list-disc list-inside font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)] space-y-1">
                    <li>Strategic AI services for banking, finance, and enterprise sectors</li>
                    <li>Agentic AI systems that enhance rather than automate</li>
                    <li>Custom AI copilots tailored to specific business processes</li>
                    <li>End-to-end implementation from strategy to deployment</li>
                  </ul>
                </div>
              </div>
            </div>

            <a href="mailto:hello@quicksort.fr">
              <Button className="gap-2.5 px-[22px] py-4 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs hover:bg-[#ccff00]/90 h-auto">
                <span className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-black text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                  Get in touch
                </span>
              </Button>
            </a>
          </div>

          <div className="relative flex-1 min-w-[480px] grow h-[496px]">
            {teamImages.map((image, index) => (
              <div
                key={index}
                className={`absolute ${image.position} ${image.size} ${image.style}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-start justify-center w-full">
          <img className="w-[1280px]" alt="Container" src="/container.svg" />
        </div>
      </div>

      {/* Core Values Section */}
      <div className="flex flex-col items-center justify-center gap-12 px-8 py-24 w-full bg-gradient-to-b from-[#0a0a0a] to-[#101010]">
        <div className="flex flex-col max-w-screen-xl items-center gap-12 w-full">
          <div className="flex flex-col items-center gap-4 w-full">
            <p className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#ccff00] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
              Who you'll work with
            </p>
            <h2 className="text-[length:var(--display-md-semibold-font-size)] text-center tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
              Some of our core values
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
            {/* Value 1: Bias for action */}
            <div className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-[#141414] border border-[#1f242f] hover:border-[#ccff00]/40 transition-all duration-300">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#ccff00]/20 to-[#ccff00]/5 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#ccff00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-text-xl-semibold text-[#f5f5f6] text-xl font-semibold text-center">
                Bias for action
              </h3>
              <p className="font-text-md-regular text-[#94969c] text-sm text-center leading-relaxed">
                We move fast, make decisions, and iterate. Speed matters—we ship and learn.
              </p>
            </div>

            {/* Value 2: Excellence */}
            <div className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-[#141414] border border-[#1f242f] hover:border-[#a78bfa]/40 transition-all duration-300">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#a78bfa]/20 to-[#a78bfa]/5 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#a78bfa]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <h3 className="font-text-xl-semibold text-[#f5f5f6] text-xl font-semibold text-center">
                Excellence
              </h3>
              <p className="font-text-md-regular text-[#94969c] text-sm text-center leading-relaxed">
                We hold ourselves to the highest standards. Good isn't good enough—we aim for exceptional.
              </p>
            </div>

            {/* Value 3: Leave your ego aside */}
            <div className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-[#141414] border border-[#1f242f] hover:border-[#f472b6]/40 transition-all duration-300">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#f472b6]/20 to-[#f472b6]/5 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#f472b6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="font-text-xl-semibold text-[#f5f5f6] text-xl font-semibold text-center">
                Leave your ego aside
              </h3>
              <p className="font-text-md-regular text-[#94969c] text-sm text-center leading-relaxed">
                The best ideas win, not the loudest voices. We collaborate with humility and respect.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-16 px-0 py-24 w-full">
        <div className="flex flex-col max-w-screen-xl items-start gap-8 px-8 py-0 w-full">
          <div className="flex flex-col items-center gap-8 w-full">
            <div className="gap-5 flex flex-col max-w-screen-md items-center w-full">
              <h2 className="mt-[-1.00px] text-[length:var(--display-md-semibold-font-size)] text-center tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                We unite world-class talent to push boundaries and build
                what&apos;s next.
              </h2>

              <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] text-center tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                We believe in building teams where unique perspectives and
                talents can thrive and everyone has what they need to excel in
                their role, career, and at home.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col max-w-screen-xl items-center gap-16 px-8 py-0 w-full">
          <div className="flex flex-col max-w-screen-md items-start gap-6 w-full">
            {jobListings.map((job, index) => (
              <Card
                key={index}
                className="flex flex-col min-w-[560px] items-center gap-6 pt-6 pb-7 px-6 w-full bg-[#101010] rounded-2xl border border-solid border-[#1f242f]"
              >
                <CardContent className="flex flex-col items-start gap-4 w-full p-0">
                  <div className="items-start gap-4 w-full flex">
                    <div className="flex-col items-start gap-1 flex-1 grow flex">
                      <div className="h-7 items-center gap-2 w-full flex">
                        <h3 className="mt-[-1.00px] font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] whitespace-nowrap [font-style:var(--text-lg-semibold-font-style)]">
                          {job.title}
                        </h3>

                        <Badge
                          className={`${job.categoryColor.bg} ${job.categoryColor.border} inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full border border-solid hover:${job.categoryColor.bg}`}
                        >
                          <div className="w-2 h-2">
                            <div
                              className={`relative top-px left-px w-1.5 h-1.5 ${job.categoryColor.dot} rounded-[3px]`}
                            />
                          </div>

                          <span
                            className={`mt-[-1.00px] font-text-sm-medium font-[number:var(--text-sm-medium-font-weight)] ${job.categoryColor.text} text-[length:var(--text-sm-medium-font-size)] text-center tracking-[var(--text-sm-medium-letter-spacing)] leading-[var(--text-sm-medium-line-height)] whitespace-nowrap [font-style:var(--text-sm-medium-font-style)]`}
                          >
                            {job.category}
                          </span>
                        </Badge>
                      </div>
                    </div>

                    <Link to={`/career/${job.slug}`} className="gap-1.5 inline-flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity">
                      <span className="mt-[-1.00px] font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#cecfd2] text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                        View job
                      </span>

                      <ArrowUpRightIcon className="w-5 h-5" />
                    </Link>
                  </div>

                  <p className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                    {job.description}
                  </p>

                  <div className="flex items-center gap-5 w-full">
                    <div className="inline-flex items-center gap-2">
                      <MapPinIcon className="w-5 h-5" />

                      <span className="mt-[-1.00px] font-text-md-medium font-[number:var(--text-md-medium-font-weight)] text-[#94969c] text-[length:var(--text-md-medium-font-size)] tracking-[var(--text-md-medium-letter-spacing)] leading-[var(--text-md-medium-line-height)] whitespace-nowrap [font-style:var(--text-md-medium-font-style)]">
                        {job.location}
                      </span>
                    </div>

                    <div className="inline-flex items-center gap-2">
                      <ClockIcon className="w-5 h-5" />

                      <span className="mt-[-1.00px] font-text-md-medium font-[number:var(--text-md-medium-font-weight)] text-[#94969c] text-[length:var(--text-md-medium-font-size)] tracking-[var(--text-md-medium-letter-spacing)] leading-[var(--text-md-medium-line-height)] whitespace-nowrap [font-style:var(--text-md-medium-font-style)]">
                        {job.type}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
