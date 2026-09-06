import { useLocale } from '@lib/i18n';
import { ArrowUpRightIcon } from "lucide-react";
import { LocaleLink as Link } from '@lib/i18n';
import { useState } from "react";
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


export const BlogPostsGridSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  const [categoryId, setCategoryId] = useState("all");
  const selectedCategory = categories.find(category => category.id === categoryId)?.label;
  const visiblePosts = blogPosts.filter(post => categoryId === "all" || post.category === selectedCategory);
  return (
    <section className="flex-col items-center gap-8 sm:gap-12 md:gap-16 pt-0 pb-12 sm:pb-16 md:pb-24 px-0 bg-surface flex w-full">
      <div className="flex flex-col max-w-screen-xl items-start gap-8 sm:gap-12 md:gap-16 px-4 sm:px-8 py-0 w-full">
        <div className="flex items-end gap-4 sm:gap-8 w-full overflow-x-auto">
          <div className="flex flex-col items-start gap-2 flex-1 min-w-0 border-b [border-bottom-style:solid] border-line">
            <Tabs value={categoryId} onValueChange={setCategoryId} className="w-full">
              <TabsList className="inline-flex items-start gap-2 sm:gap-4 h-auto bg-transparent p-0 border-0 overflow-x-auto">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="inline-flex h-9 items-center justify-center gap-2 pt-0 pb-3 px-1 data-[state=active]:border-b-2 data-[state=active]:border-line-strong data-[state=active]:bg-transparent bg-transparent rounded-none data-[state=active]:shadow-none font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-xs sm:text-sm md:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] data-[state=active]:text-ink-2 text-ink-muted whitespace-nowrap shrink-0"
                  >
                    {t(category.label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {visiblePosts.length === 0 && <p role="status" className="text-ink-muted">{t("No articles in this category yet.")}</p>}
        <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 items-start gap-6 sm:gap-8 md:gap-[48px_32px] w-full">
          {visiblePosts.map((post, index) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="flex flex-col min-w-0 w-full sm:min-w-[280px] items-start gap-4 sm:gap-5 flex-1 hover:opacity-90 transition-opacity"
            >
              <article className="flex flex-col min-w-0 w-full items-start gap-4 sm:gap-5 flex-1">
                <div
                  className="relative self-stretch w-full h-48 sm:h-56 md:h-60 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#1f242f] to-[#000000]"
                  style={
                    post.image
                      ? { background: `${post.image} 50% 50% / cover` }
                      : undefined
                  }
                />

                <div className="flex flex-col items-start gap-4 sm:gap-6 w-full">
                  <div className="flex flex-col items-start gap-2 w-full">
                    <div className="text-ink-2 text-xs sm:text-sm md:text-[length:var(--text-sm-semibold-font-size)] leading-[var(--text-sm-semibold-line-height)] self-stretch font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] tracking-[var(--text-sm-semibold-letter-spacing)] [font-style:var(--text-sm-semibold-font-style)]">
                      {t(post.category)}
                    </div>

                    <div className="flex flex-col items-start gap-2 w-full">
                      <div className="gap-3 sm:gap-4 flex items-start w-full">
                        <h3 className="flex-1 font-display-xs-semibold font-[number:var(--display-xs-semibold-font-weight)] text-ink text-lg sm:text-xl md:text-[length:var(--display-xs-semibold-font-size)] tracking-[var(--display-xs-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-xs-semibold-line-height)] [font-style:var(--display-xs-semibold-font-style)]">
                          {t(post.title)}
                        </h3>

                        <div className="inline-flex flex-col items-start pt-1 pb-0 px-0 shrink-0">
                          <ArrowUpRightIcon className="w-5 h-5 sm:w-6 sm:h-6 text-ink" />
                        </div>
                      </div>

                      <p className="self-stretch font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-ink-muted text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {t(post.description)}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>


      </div>
    </section>
  );
};
