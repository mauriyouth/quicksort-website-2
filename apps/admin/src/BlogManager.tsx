import "./blog.css";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, Search, ArrowUpRight } from "lucide-react";
import { db, errorMessage, blogCategories, validateBlogImage, type BlogRecord } from "@quicksort/candidate-db";
import { slugify } from "@quicksort/candidate-db/validation";
import { Heading, Notice, Empty, Pill } from "@quicksort/candidate-ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function BlogManager() {
  const [posts, setPosts] = useState<BlogRecord[]>([]);
  const [editing, setEditing] = useState<BlogRecord | null | undefined>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await db().from("blog_posts").select("*").order("published_at", { ascending: false });
      if (r.error) throw r.error;
      setPosts(r.data || []);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function action(work: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); setMessage(success); await load(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const visible = posts.filter(p => (category === "All" || p.category === category) && `${p.title} ${p.author}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Heading eyebrow="Ideas worth sharing" title="Blog posts" action={<button className="btn" disabled={busy} onClick={() => setEditing(null)}><Plus size={16}/>Create a post</button>}>
      Write, add a cover image and publish your team's ideas on the blog.
    </Heading>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    {editing !== undefined && <BlogEditor key={editing?.id || "new"} post={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={(values, file) => action(async () => {
      let image_path = values.image_path || "";
      let uploaded = "";
      if (file) {
        validateBlogImage(file);
        const extension = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp"}[file.type];
        uploaded = `${crypto.randomUUID()}.${extension}`;
        const r = await db().storage.from("blog-images").upload(uploaded, file, {contentType: file.type, upsert: false});
        if (r.error) throw r.error;
        image_path = uploaded;
      }
      const payload = {...values, image_path, updated_at: new Date().toISOString()};
      const r = editing
        ? await db().from("blog_posts").update(payload).eq("id", editing.id).eq("updated_at", editing.updated_at).select("id").single()
        : await db().from("blog_posts").insert(payload).select("id").single();
      if (r.error) {
        if (uploaded) await db().storage.from("blog-images").remove([uploaded]);
        if (r.error.code === "PGRST116") throw new Error("This post was changed by another editor. Refresh and reopen it before saving.");
        throw r.error;
      }
      setEditing(undefined);
    }, values.published ? "Post published on the blog." : "Draft saved.")} />}
    <section className="panel">
      <div className="toolbar"><Search size={18}/><input aria-label="Search blog posts" placeholder="Search posts or authors…" value={search} onChange={e => setSearch(e.target.value)}/>
        <select aria-label="Filter blog category" value={category} onChange={e => setCategory(e.target.value)}>{["All", ...blogCategories].map(c => <option key={c}>{c}</option>)}</select>
        <button className="btn secondary small" disabled={busy || loading} onClick={() => void load()}>Refresh</button>
      </div>
      {loading && <p role="status">Loading posts…</p>}
      {!loading && !visible.length && <Empty title="No posts found">Create a post or choose another category.</Empty>}
      {visible.map(p => <div className="list-row" key={p.id}>
        <div><h3>{p.title}</h3><p className="muted">{p.category} · {p.author} · {new Date(p.published_at).toLocaleDateString()}</p><Pill status={p.published ? "published" : "draft"}/></div>
        <div className="actions">
          {p.published && <a className="btn secondary small" href={`https://www.quicksort.fr/blog/${p.slug}`} target="_blank" rel="noopener noreferrer">View <ArrowUpRight size={14}/></a>}
          <button className="btn secondary small" disabled={busy} onClick={() => setEditing(p)}>Edit</button>
          <button className="btn secondary small" disabled={busy} onClick={() => void action(async () => {
            const r = await db().from("blog_posts").update({published: !p.published, updated_at: new Date().toISOString()}).eq("id", p.id).eq("updated_at", p.updated_at).select("id").single();
            if (r.error) throw r.error;
          }, p.published ? "Post unpublished." : "Post published.")}>{p.published ? "Unpublish" : "Publish"}</button>
        </div>
      </div>)}
    </section>
  </>;
}
type Values = Pick<BlogRecord,"title"|"slug"|"description"|"content"|"content_fr"|"category"|"author"|"image_path"|"image_alt"|"published"|"published_at">;
function BlogEditor({post,busy,onCancel,onSave}: {post:BlogRecord|null;busy:boolean;onCancel:()=>void;onSave:(values:Values,file:File|null)=>Promise<void>}) {
  const [title,setTitle] = useState(post?.title || "");
  const [slug,setSlug] = useState(post?.slug || "");
  const [body,setBody] = useState(post?.content || "");
  const [preview,setPreview] = useState(false);
  const [file,setFile] = useState<File|null>(null);
  const [image,setImage] = useState(post?.image_path ? db().storage.from("blog-images").getPublicUrl(post.image_path).data.publicUrl : "");
  const [imageError,setImageError] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setImage(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const value = (name:string) => String(f.get(name) || "").trim();
    void onSave({title:title.trim(),slug,description:value("description"),content:body.trim(),content_fr:value("content_fr"),category:value("category") as Values["category"],author:value("author"),image_path:post?.image_path || "",image_alt:value("image_alt"),published:value("published") === "on",published_at:new Date(`${value("date")}T00:00:00Z`).toISOString()},file);
  }
  return <section className="panel"><h2>{post ? "Edit blog post" : "Create a blog post"}</h2>
    <form className="form" onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,display:"grid",gap:20,minWidth:0}}>
      <div className="form-columns">
        <label>Title<input required maxLength={200} value={title} onChange={e => {setTitle(e.target.value);if(!post && slug === slugify(title))setSlug(slugify(e.target.value));}}/></label>
        <label>URL slug<input required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e => setSlug(e.target.value)}/></label>
        <label>Category<select aria-label="Category" name="category" defaultValue={post?.category || "Software Development"}>{blogCategories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Author<input name="author" required maxLength={160} defaultValue={post?.author || "Quicksort"}/></label>
        <label>Publication date<input name="date" type="date" required max={new Date().toISOString().slice(0,10)} defaultValue={(post?.published_at || new Date().toISOString()).slice(0,10)}/></label>
      </div>
      <label>Short description<textarea name="description" rows={2} maxLength={500} required defaultValue={post?.description} placeholder="A short introduction for the blog card."/></label>
      <label>Cover image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {const next=e.target.files?.[0];if(!next)return;try{validateBlogImage(next);setFile(next);setImageError("");}catch(err){setImageError(errorMessage(err));e.target.value="";}}}/><span className="muted small-text">JPG, PNG or WebP, up to 5 MB. Landscape images work best.</span></label>
      <Notice error>{imageError}</Notice>
      {image && <img src={image} alt="Cover preview" style={{width:"100%",maxWidth:640,aspectRatio:"16 / 9",objectFit:"cover",borderRadius:16}}/>}
      <label>Image description<input name="image_alt" maxLength={300} required={Boolean(image)} defaultValue={post?.image_alt} placeholder="Describe the image for readers using a screen reader."/></label>
      <div className="actions"><button type="button" className="btn secondary small" onClick={() => setPreview(!preview)}>{preview ? "Write article" : "Preview article"}</button><span className="muted small-text">Use Markdown for headings, lists, links and bold text.</span></div>
      <label>Article<textarea aria-label="Article" required maxLength={100000} rows={18} value={body} onChange={e => setBody(e.target.value)} style={preview?{position:"absolute",width:1,height:1,overflow:"hidden",opacity:0}:undefined}/></label>
      {preview && <article className="blog-preview"><h1>{title}</h1><ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown></article>}
      <details><summary>French article (optional)</summary><label>French content<textarea name="content_fr" rows={12} maxLength={100000} defaultValue={post?.content_fr}/></label><p className="muted small-text">The original article is shown when no French version is provided.</p></details>
      <label className="check"><input type="checkbox" name="published" defaultChecked={post?.published}/>Publish on the website</label>
      <div className="actions"><button className="btn" disabled={busy || Boolean(imageError)}>{busy?"Saving…":"Save post"}</button><button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </fieldset></form>
  </section>;
}


