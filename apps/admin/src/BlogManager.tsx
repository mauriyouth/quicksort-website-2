import "./blog.css";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, Search, ArrowUpRight } from "lucide-react";
import { db, errorMessage, blogCategories, validateBlogImage, type BlogRecord } from "@quicksort/hr-db";
import { slugify } from "@quicksort/hr-db/validation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@quicksort-sas/ui";
import { EmptyState, linkButton, PageAlerts, StatusBadge } from "./ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DateField } from "./DateField";

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
  return <div className="flex flex-col gap-6">
    <div className="flex justify-end">
      <Button variant="pivot" disabled={busy} onClick={() => setEditing(null)}><Plus data-icon="inline-start"/>Create a post</Button>
    </div>
    <PageAlerts error={error} message={message} />
    {editing !== undefined && <BlogEditor key={editing?.id || "new"} post={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={(values, file) => action(async () => {
      let image_path = values.image_path || "";
      let uploaded = "";
      if (file) {
        validateBlogImage(file);
        const extension = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif"}[file.type];
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
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-56 flex-1">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput aria-label="Search blog posts" placeholder="Search posts or authors…" value={search} onChange={e => setSearch(e.target.value)}/>
          </InputGroup>
          <NativeSelect aria-label="Filter blog category" value={category} onChange={e => setCategory(e.target.value)}>
            {["All", ...blogCategories].map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
          </NativeSelect>
          <Button variant="outline" disabled={busy || loading} onClick={() => void load()}>Refresh</Button>
        </div>
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading posts…</p>}
        {!loading && !visible.length && <EmptyState title="No posts found">Create a post or choose another category.</EmptyState>}
        {!!visible.length && <ItemGroup>
          {visible.map(p => <Item variant="outline" key={p.id}>
            <ItemContent className="min-w-0">
              <ItemTitle>{p.title}</ItemTitle>
              <ItemDescription>{p.category} · {p.author} · {new Date(p.published_at).toLocaleDateString()}</ItemDescription>
              <div><StatusBadge status={p.published ? "published" : "draft"}/></div>
            </ItemContent>
            <ItemActions className="flex-wrap">
              {p.published && <a className={linkButton({ variant: "outline", size: "sm" })} href={`https://www.quicksort.fr/blog/${p.slug}`} target="_blank" rel="noopener noreferrer">View <ArrowUpRight data-icon="inline-end"/></a>}
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(p)}>Edit</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => {
                const r = await db().from("blog_posts").update({published: !p.published, updated_at: new Date().toISOString()}).eq("id", p.id).eq("updated_at", p.updated_at).select("id").single();
                if (r.error) throw r.error;
              }, p.published ? "Post unpublished." : "Post published.")}>{p.published ? "Unpublish" : "Publish"}</Button>
            </ItemActions>
          </Item>)}
        </ItemGroup>}
      </CardContent>
    </Card>
  </div>;
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
  const [published,setPublished] = useState(Boolean(post?.published));
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setImage(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const value = (name:string) => String(f.get(name) || "").trim();
    void onSave({title:title.trim(),slug,description:value("description"),content:body.trim(),content_fr:value("content_fr"),category:value("category") as Values["category"],author:value("author"),image_path:post?.image_path || "",image_alt:value("image_alt"),published,published_at:new Date(`${value("date")}T00:00:00Z`).toISOString()},file);
  }
  return <Card>
    <CardHeader><CardTitle>{post ? "Edit blog post" : "Create a blog post"}</CardTitle></CardHeader>
    <CardContent>
      <form onSubmit={submit}><fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="blog-title">Title</FieldLabel>
              <Input id="blog-title" required maxLength={200} value={title} onChange={e => {setTitle(e.target.value);if(!post && slug === slugify(title))setSlug(slugify(e.target.value));}}/>
            </Field>
            <Field>
              <FieldLabel htmlFor="blog-slug">URL slug</FieldLabel>
              <Input id="blog-slug" required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e => setSlug(e.target.value)}/>
            </Field>
            <Field>
              <FieldLabel htmlFor="blog-category">Category</FieldLabel>
              <NativeSelect id="blog-category" name="category" defaultValue={post?.category || "Software Development"}>
                {blogCategories.map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="blog-author">Author</FieldLabel>
              <Input id="blog-author" name="author" required maxLength={160} defaultValue={post?.author || "Quicksort"}/>
            </Field>
            <Field>
              <FieldLabel>Publication date</FieldLabel>
              <DateField name="date" aria-label="Publication date" required max={new Date().toISOString().slice(0,10)} defaultValue={(post?.published_at || new Date().toISOString()).slice(0,10)}/>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="blog-description">Short description</FieldLabel>
            <Textarea id="blog-description" name="description" rows={2} maxLength={500} required defaultValue={post?.description} placeholder="A short introduction for the blog card."/>
          </Field>
          <Field>
            <FieldLabel htmlFor="blog-cover">Cover image</FieldLabel>
            <Input id="blog-cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => {const next=e.target.files?.[0];if(!next)return;try{validateBlogImage(next);setFile(next);setImageError("");}catch(err){setImageError(errorMessage(err));e.target.value="";}}}/>
            <FieldDescription>JPG, PNG, WebP or GIF, up to 5 MB. Landscape images work best.</FieldDescription>
          </Field>
          <PageAlerts error={imageError} />
          {image && <img src={image} alt="Cover preview" className="aspect-video w-full max-w-[640px] rounded-sm border border-border object-cover"/>}
          <Field>
            <FieldLabel htmlFor="blog-image-alt">Image description</FieldLabel>
            <Input id="blog-image-alt" name="image_alt" maxLength={300} required={Boolean(image)} defaultValue={post?.image_alt} placeholder="Describe the image for readers using a screen reader."/>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(!preview)}>{preview ? "Write article" : "Preview article"}</Button>
            <span className="text-xs text-muted-foreground">Use Markdown for headings, lists, links and bold text.</span>
          </div>
          <Field className={preview ? "sr-only" : undefined}>
            <FieldLabel htmlFor="blog-article">Article</FieldLabel>
            <Textarea id="blog-article" required maxLength={100000} rows={18} value={body} onChange={e => setBody(e.target.value)} className="min-h-96 font-mono text-xs md:text-xs"/>
          </Field>
          {preview && <article className="blog-preview"><h1>{title}</h1><ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown></article>}
          <details className="group rounded-sm border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">French article (optional)</summary>
            <Field className="mt-3">
              <FieldLabel htmlFor="blog-content-fr">French content</FieldLabel>
              <Textarea id="blog-content-fr" name="content_fr" rows={12} maxLength={100000} defaultValue={post?.content_fr} className="min-h-64 font-mono text-xs md:text-xs"/>
              <FieldDescription>The original article is shown when no French version is provided.</FieldDescription>
            </Field>
          </details>
          <Field orientation="horizontal">
            <Checkbox id="blog-published" checked={published} onCheckedChange={(checked) => setPublished(checked === true)}/>
            <FieldLabel htmlFor="blog-published" className="font-normal">Publish on the website</FieldLabel>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || Boolean(imageError)}>{busy?"Saving…":"Save post"}</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </FieldGroup>
      </fieldset></form>
    </CardContent>
  </Card>;
}
