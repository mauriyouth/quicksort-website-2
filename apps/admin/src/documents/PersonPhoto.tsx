import { useEffect, useState } from "react";
import { DOCUMENTS_CHANGED, fetchDocumentFile, loadPersonPhoto, type DocumentOwner } from "./client";

/**
 * The person's filed photo (document type PHOTO), or their initials while it
 * loads, when none is filed, or when it cannot be read. Reloads when the
 * person's documents change (upload, renewal, archive).
 */
export function PersonPhoto({ personId, name, fallback, className }: {
  personId: string;
  name: string;
  /** Shown when there is no photo, typically the initials. */
  fallback: string;
  className: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

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
    let url: string | null = null;
    (async () => {
      const photo = await loadPersonPhoto(personId);
      if (!photo || (photo.mime_type && !photo.mime_type.startsWith("image/"))) return null;
      const file = await fetchDocumentFile(photo);
      // Large files answer a Drive link, which cannot be shown inline.
      return file instanceof Blob ? file : null;
    })().then(blob => {
      if (cancelled) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setSrc(url);
    }, () => { if (!cancelled) setSrc(null); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [personId, version]);

  return src
    ? <img className={`${className} has-photo`} src={src} alt={`Photo of ${name}`} />
    : <span className={className} aria-hidden="true">{fallback}</span>;
}
