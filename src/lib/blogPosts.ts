// Blog post metadata and content loader
export interface BlogPostMetadata {
  slug: string;
  title: string;
  description: string;
  category: string;
  image?: string;
  publishedDate?: string;
}

export const blogPosts: BlogPostMetadata[] = [
  {
    slug: "the-age-of-human-ai-collaboration",
    title: "The Age Of Human + AI Collaboration",
    description: "The future of work is not human or AI — it's collaborating by design.",
    category: "Software Development",
    publishedDate: "January 2024",
  },
];

export function getBlogPost(slug: string): BlogPostMetadata | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function getAllBlogPosts(): BlogPostMetadata[] {
  return blogPosts;
}
