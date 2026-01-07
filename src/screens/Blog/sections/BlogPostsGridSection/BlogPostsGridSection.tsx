import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../../../components/ui/tabs";

const categories = [
  { id: "all", label: "View all" },
  { id: "software", label: "Software Development" },
  { id: "data", label: "Data" },
  { id: "design", label: "Design" },
  { id: "infrastructure", label: "Infrastructure" },
];

const blogPosts = [
  {
    image: "url(..//image.png)",
    category: "Software Development",
    title: "The Age Of Human + AI Collaboration",
    description:
      "The future of work is not human or AI — it's collaborating by design.",
  },
  {
    image: "url(..//image-1.png)",
    category: "Software Development",
    title: "Migrating to Linear 101",
    description:
      "Linear helps streamline software projects, sprints, tasks, and bug tracking. Here's how to get started.",
  },
  {
    image: "url(..//image-2.png)",
    category: "Data",
    title: "Building your API stack",
    description:
      "The rise of RESTful APIs has been met by a rise in tools for creating, testing, and managing them.",
  },
  {
    image: "url(..//image-3.png)",
    category: "Design",
    title: "Bill Walsh leadership lessons",
    description:
      "Like to know the secrets of transforming a 2-14 team into a 3x Super Bowl winning Dynasty?",
  },
  {
    image: "url(..//image-4.png)",
    category: "Infrastructure",
    title: "PM mental models",
    description:
      "Mental models are simple expressions of complex processes or relationships.",
  },
  {
    image: "url(..//image-5.png)",
    category: "Data",
    title: "What is wireframing?",
    description:
      "Introduction to Wireframing and its Principles. Learn from the best in the industry.",
  },
];

const pageNumbers = [
  { number: "1", isActive: true },
  { number: "2", isActive: false },
  { number: "3", isActive: false },
  { number: "...", isActive: false },
  { number: "8", isActive: false },
  { number: "9", isActive: false },
  { number: "10", isActive: false },
];

export const BlogPostsGridSection = (): JSX.Element => {
  return (
    <section className="flex-col items-center gap-16 pt-0 pb-24 px-0 bg-[#141414] flex w-full">
      <div className="flex flex-col max-w-screen-xl items-start gap-16 px-8 py-0 w-full">
        <div className="flex items-end gap-8 w-full">
          <div className="flex flex-col items-start gap-2 flex-1 border-b [border-bottom-style:solid] border-[#1f242f]">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="inline-flex items-start gap-4 h-auto bg-transparent p-0 border-0">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="inline-flex h-9 items-center justify-center gap-2 pt-0 pb-3 px-1 data-[state=active]:border-b-2 data-[state=active]:border-[#cecfd2] data-[state=active]:bg-transparent bg-transparent rounded-none data-[state=active]:shadow-none font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] data-[state=active]:text-[#cecfd2] text-[#94969c] whitespace-nowrap"
                  >
                    {category.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-[48px_32px] w-full">
          {blogPosts.map((post, index) => (
            <article
              key={index}
              className="flex flex-col min-w-80 items-start gap-5 flex-1"
            >
              <div
                className="relative self-stretch w-full h-60 rounded-2xl"
                style={{ background: `${post.image} 50% 50% / cover` }}
              />

              <div className="flex flex-col items-start gap-6 w-full">
                <div className="flex flex-col items-start gap-2 w-full">
                  <div className="text-[#cecfd2] text-[length:var(--text-sm-semibold-font-size)] leading-[var(--text-sm-semibold-line-height)] self-stretch font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] tracking-[var(--text-sm-semibold-letter-spacing)] [font-style:var(--text-sm-semibold-font-style)]">
                    {post.category}
                  </div>

                  <div className="flex flex-col items-start gap-2 w-full">
                    <div className="gap-4 flex items-start w-full">
                      <h3 className="flex-1 font-display-xs-semibold font-[number:var(--display-xs-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-xs-semibold-font-size)] tracking-[var(--display-xs-semibold-letter-spacing)] leading-[var(--display-xs-semibold-line-height)] [font-style:var(--display-xs-semibold-font-style)]">
                        {post.title}
                      </h3>

                      <div className="inline-flex flex-col items-start pt-1 pb-0 px-0">
                        <ArrowUpRightIcon className="w-6 h-6 text-[#f5f5f6]" />
                      </div>
                    </div>

                    <p className="self-stretch font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                      {post.description}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <nav className="flex items-center justify-center gap-5 pt-5 pb-0 px-0 w-full border-t [border-top-style:solid] border-[#1f242f]">
          <div className="flex h-5 items-center flex-1">
            <Button
              variant="ghost"
              className="gap-1.5 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent"
            >
              <ArrowLeftIcon className="w-5 h-5 text-[#94969c]" />
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                Previous
              </span>
            </Button>
          </div>

          <div className="inline-flex items-start gap-0.5">
            {pageNumbers.map((page, index) => (
              <Button
                key={index}
                variant="ghost"
                className={`w-10 h-10 p-3 rounded-full hover:bg-[#1f242f] ${
                  page.isActive ? "bg-[#1f242f]" : ""
                }`}
              >
                <span
                  className={`font-text-sm-medium font-[number:var(--text-sm-medium-font-weight)] text-[length:var(--text-sm-medium-font-size)] tracking-[var(--text-sm-medium-letter-spacing)] leading-[var(--text-sm-medium-line-height)] [font-style:var(--text-sm-medium-font-style)] ${
                    page.isActive ? "text-[#ececed]" : "text-[#94969c]"
                  }`}
                >
                  {page.number}
                </span>
              </Button>
            ))}
          </div>

          <div className="flex h-5 items-center justify-end flex-1">
            <Button
              variant="ghost"
              className="gap-1.5 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent"
            >
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                Next
              </span>
              <ArrowRightIcon className="w-5 h-5 text-[#94969c]" />
            </Button>
          </div>
        </nav>
      </div>
    </section>
  );
};
