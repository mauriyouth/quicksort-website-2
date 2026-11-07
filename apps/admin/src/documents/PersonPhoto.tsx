import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera } from "lucide-react";
import "./documents.css";
import { db } from "@quicksort/hr-db";
import { DOCUMENTS_CHANGED, fetchDocumentFile, notifyDocumentsChanged, uploadDocument, type DocumentOwner } from "./client";

/** Formats a browser can decode onto a canvas, so they can be resized. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** Longest side of the stored portrait: plenty for an avatar, small enough to render inline. */
const MAX_SIDE = 800;

/**
 * Downscales the picked image to a JPEG of at most MAX_SIDE px, so the filed
 * photo stays light (large Drive files only answer a link and cannot be shown
 * inline). Falls back to the original file when the browser cannot decode it.
 */
async function preparePhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

type CachedPhoto = { id: string; url: string | null } | null;

/**
 * Session cache of person photos, shared by every avatar (list rows, header).
 * Lookups made in the same tick are batched into one documents query; only
 * people who have a photo are then downloaded, once. An owner's entry is
 * dropped when their documents change, so the next render reloads it.
 */
const photoCache = new Map<string, Promise<CachedPhoto>>();
let pendingLookups = new Map<string, (photo: Promise<CachedPhoto>) => void>();

function flushLookups() {
  const batch = pendingLookups;
  pendingLookups = new Map();
  const ids = [...batch.keys()];
  const rows = (async () => {
    const found = new Map<string, { id: string; mime_type: string | null }>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db()
        .from("documents")
        .select("id,person_id,mime_type")
        .in("person_id", ids.slice(i, i + 100))
        .eq("type_code", "PHOTO")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Newest first: keep the first row seen per person.
      for (const row of data || []) if (row.person_id && !found.has(row.person_id)) found.set(row.person_id, row);
    }
    return found;
  })();
  for (const [personId, resolve] of batch) {
    resolve(rows.then(async found => {
      const doc = found.get(personId);
      if (!doc) return null;
      if (doc.mime_type && !doc.mime_type.startsWith("image/")) return { id: doc.id, url: null };
      const file = await fetchDocumentFile(doc);
      // Large files answer a Drive link, which cannot be shown inline.
      return { id: doc.id, url: file instanceof Blob ? URL.createObjectURL(file) : null };
    }));
  }
}

function photoFor(personId: string): Promise<CachedPhoto> {
  let cached = photoCache.get(personId);
  if (!cached) {
    cached = new Promise<CachedPhoto>((resolve, reject) => {
      if (!pendingLookups.size) queueMicrotask(flushLookups);
      pendingLookups.set(personId, photo => photo.then(resolve, reject));
    });
    // A failed lookup is retried on the next render instead of sticking.
    cached.catch(() => photoCache.delete(personId));
    photoCache.set(personId, cached);
  }
  return cached;
}

// Registered at import, before any avatar listener, so avatars reload fresh data.
window.addEventListener(DOCUMENTS_CHANGED, event => {
  const owner = (event as CustomEvent<DocumentOwner>).detail;
  if (owner?.kind !== "person") return;
  const stale = photoCache.get(owner.id);
  photoCache.delete(owner.id);
  void stale?.then(photo => { if (photo?.url) URL.revokeObjectURL(photo.url); }, () => undefined);
});

/**
 * The person's filed photo (document type PHOTO), or their initials while it
 * loads, when none is filed, or when it cannot be read. Reloads when the
 * person's documents change (upload, renewal, archive).
 *
 * With `editable`, clicking it picks a new image that is filed in the
 * person's HR folder (Identité) as a PHOTO document, replacing the current
 * one — the previous photo is kept in the document history.
 */
export function PersonPhoto({ personId, name, fallback, className, editable = false }: {
  personId: string;
  name: string;
  /** Shown when there is no photo, typically the initials. */
  fallback: string;
  className: string;
  editable?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const owner = (event as CustomEvent<DocumentOwner>).detail;
      if (owner?.kind === "person" && owner.id === personId) setVersion(v => v + 1);
    };
    window.addEventListener(DOCUMENTS_CHANGED, onChanged);
    return () => window.removeEventListener(DOCUMENTS_CHANGED, onChanged);
  }, [personId]);

  useEffect(() => {
    let cancelled = false;
    photoFor(personId).then(photo => {
      if (cancelled) return;
      setPhotoId(photo?.id ?? null);
      setSrc(photo?.url ?? null);
    }, () => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [personId, version]);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setError("");
    if (!PHOTO_TYPES.includes(picked.type)) return setError("Choose a JPEG, PNG or WebP image.");
    if (picked.size > MAX_SOURCE_BYTES) return setError("This image is too large (20 MB max).");
    const owner: DocumentOwner = { kind: "person", id: personId };
    setProgress(0);
    try {
      const file = await preparePhoto(picked);
      await uploadDocument(owner, file, { typeCode: "PHOTO", title: `Photo — ${name}`, supersedes: photoId }, setProgress);
      notifyDocumentsChanged(owner);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The photo could not be saved.");
    } finally {
      setProgress(null);
    }
  }

  const visual = src
    ? <img className={`${className} has-photo`} src={src} alt={editable ? "" : `Photo of ${name}`} />
    : <span className={className} aria-hidden="true">{fallback}</span>;

  if (!editable) return visual;

  const busy = progress !== null;
  return (
    <span className="person-photo-edit">
      <button
        type="button"
        className="person-photo-button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={src ? `Change the photo of ${name}` : `Add a photo of ${name}`}
        title={src ? "Change photo" : "Add photo"}
      >
        {visual}
        <span className={`person-photo-overlay${busy ? " is-busy" : ""}`} aria-hidden="true">
          {busy ? `${progress}%` : <Camera size={16} />}
        </span>
      </button>
      <input ref={input} type="file" accept={PHOTO_TYPES.join(",")} hidden onChange={event => void onPick(event)} />
      {error && (
        <span className="person-photo-error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")} aria-label="Dismiss">×</button>
        </span>
      )}
    </span>
  );
}
