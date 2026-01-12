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
  {
    slug: "migrating-to-linear-101",
    title: "Migrating to Linear 101",
    description:
      "Linear helps streamline software projects, sprints, tasks, and bug tracking. Here's how to get started.",
    category: "Software Development",
  },
  {
    slug: "building-your-api-stack",
    title: "Building your API stack",
    description:
      "The rise of RESTful APIs has been met by a rise in tools for creating, testing, and managing them.",
    category: "Data",
  },
  {
    slug: "bill-walsh-leadership-lessons",
    title: "Bill Walsh leadership lessons",
    description:
      "Like to know the secrets of transforming a 2-14 team into a 3x Super Bowl winning Dynasty?",
    category: "Design",
  },
  {
    slug: "pm-mental-models",
    title: "PM mental models",
    description:
      "Mental models are simple expressions of complex processes or relationships.",
    category: "Infrastructure",
  },
  {
    slug: "what-is-wireframing",
    title: "What is wireframing?",
    description:
      "Introduction to Wireframing and its Principles. Learn from the best in the industry.",
    category: "Data",
  },
];

export function getBlogPost(slug: string): BlogPostMetadata | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function getAllBlogPosts(): BlogPostMetadata[] {
  return blogPosts;
}
