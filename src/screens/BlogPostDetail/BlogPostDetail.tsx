import { useParams, Link } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { SiteFooter } from "../../components/SiteFooter";
import { getBlogPost } from "../../lib/blogPosts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";

// Pre-load all markdown files using Vite's glob import
const markdownModules = import.meta.glob("../../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: false,
});

export const BlogPostDetail = (): JSX.Element => {
  const { slug } = useParams<{ slug: string }>();
  const [markdownContent, setMarkdownContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const post = slug ? getBlogPost(slug) : undefined;

  useEffect(() => {
    if (!slug) return;

    const loadMarkdown = async () => {
      try {
        // Use Vite's glob import to load the markdown file
        const modulePath = `../../content/blog/${slug}.md`;
        const loader = markdownModules[modulePath];

        if (loader) {
          const content = await loader();
          setMarkdownContent(content as string);
        } else {
          throw new Error("Markdown file not found");
        }
      } catch (error) {
        console.error("Error loading markdown:", error);
        setMarkdownContent("# Post Not Found\n\nThe requested blog post could not be found.");
      } finally {
        setLoading(false);
      }
    };

    loadMarkdown();
  }, [slug]);

  if (!post) {
    return (
      <main className="flex flex-col w-full items-center relative bg-[#141414] min-h-screen">
        <MainNavigationSection />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <h1 className="text-2xl font-bold text-[#f5f5f6] mb-4">Post Not Found</h1>
          <Link to="/blog">
            <Button variant="outline">Back to Blog</Button>
          </Link>
        </div>
        <SiteFooter />
      </main>
    );
  }

  return (
    <main className="flex flex-col w-full items-center relative bg-[#141414] min-h-screen">
      <MainNavigationSection />

      <article className="flex flex-col max-w-4xl w-full px-4 sm:px-8 py-12 sm:py-16 md:py-24">
        <div className="mb-8">
          <Link to="/blog">
            <Button
              variant="ghost"
              className="gap-2 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent mb-6"
            >
              <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#94969c]" />
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] [font-style:var(--text-sm-semibold-font-style)]">
                Back to Blog
              </span>
            </Button>
          </Link>

          <div className="flex flex-col gap-4 mb-8">
            <div className="text-[#cecfd2] text-xs sm:text-sm md:text-[length:var(--text-sm-semibold-font-size)] leading-[var(--text-sm-semibold-line-height)] font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] tracking-[var(--text-sm-semibold-letter-spacing)] [font-style:var(--text-sm-semibold-font-style)]">
              {post.category}
            </div>

            <h1 className="font-display-lg-semibold font-[number:var(--display-lg-semibold-font-weight)] text-[#f5f5f6] text-3xl sm:text-4xl md:text-5xl tracking-[var(--display-lg-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-lg-semibold-line-height)] [font-style:var(--display-lg-semibold-font-style)]">
              {post.title}
            </h1>

            {post.publishedDate && (
              <div className="text-[#94969c] text-sm sm:text-base">
                Published: {post.publishedDate}
              </div>
            )}

            <p className="text-[#94969c] text-lg sm:text-xl leading-relaxed">
              {post.description}
            </p>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none">
          {loading ? (
            <div className="text-[#94969c]">Loading...</div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ node, ...props }) => (
                  <h1
                    className="font-display-md-semibold text-[#f5f5f6] mt-8 mb-4 text-3xl sm:text-4xl"
                    {...props}
                  />
                ),
                h2: ({ node, ...props }) => (
                  <h2
                    className="font-display-sm-semibold text-[#f5f5f6] mt-8 mb-4 text-2xl sm:text-3xl"
                    {...props}
                  />
                ),
                h3: ({ node, ...props }) => (
                  <h3
                    className="font-display-xs-semibold text-[#f5f5f6] mt-6 mb-3 text-xl sm:text-2xl"
                    {...props}
                  />
                ),
                p: ({ node, ...props }) => (
                  <p
                    className="text-[#94969c] mb-4 leading-relaxed text-base sm:text-lg"
                    {...props}
                  />
                ),
                ul: ({ node, ...props }) => (
                  <ul className="list-disc list-inside text-[#94969c] mb-4 space-y-2 ml-4" {...props} />
                ),
                ol: ({ node, ...props }) => (
                  <ol className="list-decimal list-inside text-[#94969c] mb-4 space-y-2 ml-4" {...props} />
                ),
                li: ({ node, ...props }) => (
                  <li className="text-[#94969c] leading-relaxed" {...props} />
                ),
                strong: ({ node, ...props }) => (
                  <strong className="font-semibold text-[#ececed]" {...props} />
                ),
                em: ({ node, ...props }) => (
                  <em className="italic text-[#94969c]" {...props} />
                ),
                a: ({ node, ...props }) => (
                  <a
                    className="text-[#cecfd2] underline hover:text-[#f5f5f6] transition-colors"
                    {...props}
                  />
                ),
                blockquote: ({ node, ...props }) => (
                  <blockquote
                    className="border-l-4 border-[#1f242f] pl-4 italic text-[#94969c] my-4"
                    {...props}
                  />
                ),
                code: ({ node, inline, ...props }: any) =>
                  inline ? (
                    <code
                      className="bg-[#1f242f] text-[#cecfd2] px-1.5 py-0.5 rounded text-sm font-mono"
                      {...props}
                    />
                  ) : (
                    <code
                      className="block bg-[#1f242f] text-[#cecfd2] p-4 rounded-lg my-4 overflow-x-auto text-sm font-mono"
                      {...props}
                    />
                  ),
                hr: ({ node, ...props }) => (
                  <hr className="border-[#1f242f] my-8" {...props} />
                ),
              }}
            >
              {markdownContent}
            </ReactMarkdown>
          )}
        </div>
      </article>

      <SiteFooter />
    </main>
  );
};
