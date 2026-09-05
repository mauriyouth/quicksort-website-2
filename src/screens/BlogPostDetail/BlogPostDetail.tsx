import { useParams, Link } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";
import { getBlogPost } from "@lib/blogPosts";
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
        // Find the matching loader by checking all keys in the glob
        // Vite's glob creates keys that match the file paths
        const matchingKey = Object.keys(markdownModules).find(key => 
          key.endsWith(`${slug}.md`)
        );

        if (matchingKey && markdownModules[matchingKey]) {
          const loader = markdownModules[matchingKey];
          const content = await loader();
          setMarkdownContent(content as string);
        } else {
          console.error("Markdown file not found for slug:", slug);
          console.error("Available modules:", Object.keys(markdownModules));
          throw new Error(`Markdown file not found for slug: ${slug}`);
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
      <main className="flex flex-col w-full items-center relative bg-surface min-h-screen overflow-x-hidden">
        <MainNavigationSection />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <h1 className="text-2xl font-bold text-ink mb-4">Post Not Found</h1>
          <Link to="/blog">
            <Button variant="outline">Back to Blog</Button>
          </Link>
        </div>
        <SiteFooter />
      </main>
    );
  }

  return (
    <main className="flex flex-col w-full items-center relative bg-surface min-h-screen overflow-x-hidden">
      <MainNavigationSection />

      <article className="flex flex-col max-w-4xl w-full px-4 sm:px-8 py-12 sm:py-16 md:py-24">
        <div className="mb-8">
          <Link to="/blog">
            <Button
              variant="ghost"
              className="gap-2 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent mb-6"
            >
              <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-ink-muted" />
              <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-ink-muted text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] [font-style:var(--text-sm-semibold-font-style)]">
                Back to Blog
              </span>
            </Button>
          </Link>

          <div className="flex flex-col gap-4 mb-8">
            <div className="text-ink-2 text-xs sm:text-sm md:text-[length:var(--text-sm-semibold-font-size)] leading-[var(--text-sm-semibold-line-height)] font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] tracking-[var(--text-sm-semibold-letter-spacing)] [font-style:var(--text-sm-semibold-font-style)]">
              {post.category}
            </div>

            <h1 className="font-display-lg-semibold font-[number:var(--display-lg-semibold-font-weight)] text-ink text-3xl sm:text-4xl md:text-5xl tracking-[var(--display-lg-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-lg-semibold-line-height)] [font-style:var(--display-lg-semibold-font-style)]">
              {post.title}
            </h1>

            {post.publishedDate && (
              <div className="text-ink-muted text-sm sm:text-base">
                Published: {post.publishedDate}
              </div>
            )}

            <p className="text-ink-muted text-lg sm:text-xl leading-relaxed">
              {post.description}
            </p>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none">
          {loading ? (
            <div className="text-ink-muted">Loading...</div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ node, ...props }) => (
                  <h1
                    className="font-display-md-semibold text-ink mt-8 mb-4 text-3xl sm:text-4xl"
                    {...props}
                  />
                ),
                h2: ({ node, ...props }) => (
                  <h2
                    className="font-display-sm-semibold text-ink mt-8 mb-4 text-2xl sm:text-3xl"
                    {...props}
                  />
                ),
                h3: ({ node, ...props }) => (
                  <h3
                    className="font-display-xs-semibold text-ink mt-6 mb-3 text-xl sm:text-2xl"
                    {...props}
                  />
                ),
                p: ({ node, ...props }) => (
                  <p
                    className="text-ink-muted mb-4 leading-relaxed text-base sm:text-lg"
                    {...props}
                  />
                ),
                ul: ({ node, ...props }) => (
                  <ul className="list-disc list-inside text-ink-muted mb-4 space-y-2 ml-4" {...props} />
                ),
                ol: ({ node, ...props }) => (
                  <ol className="list-decimal list-inside text-ink-muted mb-4 space-y-2 ml-4" {...props} />
                ),
                li: ({ node, ...props }) => (
                  <li className="text-ink-muted leading-relaxed" {...props} />
                ),
                strong: ({ node, ...props }) => (
                  <strong className="font-semibold text-ink" {...props} />
                ),
                em: ({ node, ...props }) => (
                  <em className="italic text-ink-muted" {...props} />
                ),
                a: ({ node, ...props }) => (
                  <a
                    className="text-ink-2 underline hover:text-ink transition-colors"
                    {...props}
                  />
                ),
                blockquote: ({ node, ...props }) => (
                  <blockquote
                    className="border-l-4 border-line pl-4 italic text-ink-muted my-4"
                    {...props}
                  />
                ),
                code: ({ node, inline, ...props }: any) =>
                  inline ? (
                    <code
                      className="bg-surface-sunken text-ink-2 px-1.5 py-0.5 rounded text-sm font-mono"
                      {...props}
                    />
                  ) : (
                    <code
                      className="block bg-surface-sunken text-ink-2 p-4 rounded-lg my-4 overflow-x-auto text-sm font-mono"
                      {...props}
                    />
                  ),
                hr: ({ node, ...props }) => (
                  <hr className="border-line my-8" {...props} />
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
