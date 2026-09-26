export const blogCategories = ["Software Development", "Data", "Design", "Infrastructure", "Voice AI"] as const;
export type BlogCategory = typeof blogCategories[number];
export type BlogRecord = {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  content_fr: string;
  category: BlogCategory;
  author: string;
  image_path: string;
  image_alt: string;
  published: boolean;
  published_at: string;
  created_at: string;
  updated_at: string;
}
export type BlogInsert = Pick<BlogRecord, "slug" | "title"> & Partial<Omit<BlogRecord, "slug" | "title">>;
export function validateBlogImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
}

