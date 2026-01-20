import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";
import { getAllBlogPosts } from "@lib/blogPosts";

const categories = [
  { id: "all", label: "View all" },
  { id: "software", label: "Software Development" },
  { id: "data", label: "Data" },
  { id: "design", label: "Design" },
  { id: "infrastructure", label: "Infrastructure" },
];

const blogPosts = getAllBlogPosts();

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
    <section className="flex-col items-center gap-8 sm:gap-12 md:gap-16 pt-0 pb-12 sm:pb-16 md:pb-24 px-0 bg-[#141414] flex w-full">
      <div className="flex flex-col max-w-screen-xl items-start gap-8 sm:gap-12 md:gap-16 px-4 sm:px-8 py-0 w-full">
        <div className="flex items-end gap-4 sm:gap-8 w-full overflow-x-auto">
          <div className="flex flex-col items-start gap-2 flex-1 min-w-0 border-b [border-bottom-style:solid] border-[#1f242f]">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="inline-flex items-start gap-2 sm:gap-4 h-auto bg-transparent p-0 border-0 overflow-x-auto">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="inline-flex h-9 items-center justify-center gap-2 pt-0 pb-3 px-1 data-[state=active]:border-b-2 data-[state=active]:border-[#cecfd2] data-[state=active]:bg-transparent bg-transparent rounded-none data-[state=active]:shadow-none font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-xs sm:text-sm md:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] data-[state=active]:text-[#cecfd2] text-[#94969c] whitespace-nowrap shrink-0"
                  >
                    {category.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 items-start gap-6 sm:gap-8 md:gap-[48px_32px] w-full">
          {blogPosts.map((post, index) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="flex flex-col min-w-0 w-full sm:min-w-[280px] items-start gap-4 sm:gap-5 flex-1 hover:opacity-90 transition-opacity"
            >
              <article className="flex flex-col min-w-0 w-full items-start gap-4 sm:gap-5 flex-1">
                <div
                  className="relative self-stretch w-full h-48 sm:h-56 md:h-60 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#1f242f] to-[#141414]"
                  style={
                    post.image
                      ? { background: `${post.image} 50% 50% / cover` }
                      : undefined
                  }
                />

                <div className="flex flex-col items-start gap-4 sm:gap-6 w-full">
                  <div className="flex flex-col items-start gap-2 w-full">
                    <div className="text-[#cecfd2] text-xs sm:text-sm md:text-[length:var(--text-sm-semibold-font-size)] leading-[var(--text-sm-semibold-line-height)] self-stretch font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] tracking-[var(--text-sm-semibold-letter-spacing)] [font-style:var(--text-sm-semibold-font-style)]">
                      {post.category}
                    </div>

                    <div className="flex flex-col items-start gap-2 w-full">
                      <div className="gap-3 sm:gap-4 flex items-start w-full">
                        <h3 className="flex-1 font-display-xs-semibold font-[number:var(--display-xs-semibold-font-weight)] text-[#f5f5f6] text-lg sm:text-xl md:text-[length:var(--display-xs-semibold-font-size)] tracking-[var(--display-xs-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-xs-semibold-line-height)] [font-style:var(--display-xs-semibold-font-style)]">
                          {post.title}
                        </h3>

                        <div className="inline-flex flex-col items-start pt-1 pb-0 px-0 shrink-0">
                          <ArrowUpRightIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#f5f5f6]" />
                        </div>
                      </div>

                      <p className="self-stretch font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {post.description}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>

        <nav className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5 pt-5 pb-0 px-0 w-full border-t [border-top-style:solid] border-[#1f242f]">
          <div className="flex h-5 items-center flex-1 w-full sm:w-auto justify-start sm:justify-start">
            <Button
              variant="ghost"
              className="gap-1.5 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent"
            >
              <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#94969c]" />
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                Previous
              </span>
            </Button>
          </div>

          <div className="inline-flex items-start gap-0.5 overflow-x-auto">
            {pageNumbers.map((page, index) => (
              <Button
                key={index}
                variant="ghost"
                className={`w-8 h-8 sm:w-10 sm:h-10 p-2 sm:p-3 rounded-full hover:bg-[#1f242f] shrink-0 ${
                  page.isActive ? "bg-[#1f242f]" : ""
                }`}
              >
                <span
                  className={`font-text-sm-medium font-[number:var(--text-sm-medium-font-weight)] text-xs sm:text-[length:var(--text-sm-medium-font-size)] tracking-[var(--text-sm-medium-letter-spacing)] leading-[var(--text-sm-medium-line-height)] [font-style:var(--text-sm-medium-font-style)] ${
                    page.isActive ? "text-[#ececed]" : "text-[#94969c]"
                  }`}
                >
                  {page.number}
                </span>
              </Button>
            ))}
          </div>

          <div className="flex h-5 items-center justify-end flex-1 w-full sm:w-auto">
            <Button
              variant="ghost"
              className="gap-1.5 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent"
            >
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] whitespace-nowrap [font-style:var(--text-sm-semibold-font-style)]">
                Next
              </span>
              <ArrowRightIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#94969c]" />
            </Button>
          </div>
        </nav>
      </div>
    </section>
  );
};
