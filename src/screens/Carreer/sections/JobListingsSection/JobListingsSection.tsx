import { ArrowUpRightIcon, ClockIcon, MapPinIcon } from "lucide-react";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";

const jobListings = [
  {
    title: "AI Engineering",
    category: "Software",
    categoryColor: {
      bg: "bg-[#4e0d30]",
      border: "border-[#9e155e]",
      dot: "bg-[#ed46bb]",
      text: "text-[#f9a7df]",
    },
    description: "We're looking for a mid-level AI Engineer to join our team.",
    location: "Paris",
    type: "Full-time",
  },
  {
    title: "Product Designer",
    category: "Design",
    categoryColor: {
      bg: "bg-[#102955]",
      border: "border-[#1849a9]",
      dot: "bg-[#2e90fa]",
      text: "text-[#84caff]",
    },
    description:
      "We're looking for a mid-level product designer to join our team.",
    location: "Paris",
    type: "Full-time",
  },
  {
    title: "Product Designer",
    category: "Strategy",
    categoryColor: {
      bg: "bg-[#501b0f]",
      border: "border-[#932f18]",
      dot: "bg-[#ef681f]",
      text: "text-[#f7b279]",
    },
    description:
      "We're looking for a mid-level product designer to join our team.",
    location: "Paris",
    type: "Full-time",
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
              <div className="flex flex-col items-start gap-3 w-full">
                <p className="mt-[-1.00px] font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#cecfd2] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                  Get to know us
                </p>

                <h2 className="text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                  We&apos;re just getting started
                </h2>
              </div>

              <div className="flex flex-col h-[200px] items-start gap-5">
                <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  Untitled is growing fast, and we are always looking for
                  passionate, dynamic, and talented individuals to join our
                  distributed team all around the world.
                </p>

                <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  Our philosophy is simple — hire a team of diverse and
                  passionate people and foster a culture that empowers you to do
                  you best work. Read more about
                </p>
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

                    <button className="gap-1.5 inline-flex items-center justify-center cursor-pointer">
                      <span className="mt-[-1.00px] font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#cecfd2] text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                        View job
                      </span>

                      <ArrowUpRightIcon className="w-5 h-5" />
                    </button>
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
