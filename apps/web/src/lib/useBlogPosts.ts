import { useEffect, useState } from "react";
import { publicDb } from "@quicksort/db";
import { getAllBlogPosts, type BlogPostMetadata } from "./blogPosts";

export function useBlogPosts() {
  const [posts, setPosts] = useState<BlogPostMetadata[]>(getAllBlogPosts);
  const [loading, setLoading] = useState(Boolean(publicDb));
  const [error, setError] = useState(false);
  useEffect(() => {
    const client = publicDb;
    if (!client) return;
    let active = true;
    async function load() {
      try {
        const { data, error } = await client!.from("blog_posts")
          .select("slug,title,description,category,image_path,image_alt,published_at,content,content_fr")
          .eq("published", true).order("published_at", { ascending: false });
        if (error) throw error;
        if (active) {
          setPosts((data || []).map(post => ({
            slug: post.slug, title: post.title, description: post.description,
            category: post.category, publishedDate: post.published_at.slice(0, 10),
            image: post.image_path ? client!.storage.from("blog-images").getPublicUrl(post.image_path).data.publicUrl : undefined,
            imageAlt: post.image_alt, content: post.content, contentFr: post.content_fr,
          })));
          setError(false);
        }
      } catch {
        if (active) { setPosts([]); setError(true); }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, []);
  return { posts, loading, error };
}
