import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useSession } from "@clerk/react";
import { ExternalLink, FileText, FolderOpen, Trash2, Upload } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import "./project-contract.css";

/**
 * Contract section on the project edit page (sales.md §14). The contract
 * and its annexes live in one Google Drive folder per contract, named
 * "<Client>/<Contract>" under the shared Contrats_Clients root, created (or
 * matched) on the first upload by /api/google-drive. Files stream directly to
 * a resumable upload session so contract PDFs are not limited by the
 * serverless request-body size.
 */
export type ContractFolder = {
  id: string;
  name: string;
  webViewLink?: string;
};

export type ContractFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const formatBytes = (value?: string) => {
  const size = Number(value || 0);
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

export function ProjectContractSection({
  projectId,
  folder,
  title,
  onLinked,
}: {
  projectId: string;
  folder: ContractFolder | null;
  /** Card heading — when set, the "Open in Drive" link moves up into it. */
  title?: string;
  /** Called when the Drive folder is created/matched so the table can cache it. */
  onLinked: (folder: ContractFolder) => void;
}) {
  const { session } = useSession();
  const [current, setCurrent] = useState<ContractFolder | null>(folder);
  const [files, setFiles] = useState<ContractFile[] | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // The parent re-renders this section with the cached folder once the
  // project row is updated — keep the local copy in sync.
  useEffect(() => setCurrent(folder), [folder]);

  const request = useCallback(
    async (body: unknown) => {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Sign in again to manage contracts.");
      const response = await fetch("/api/google-drive", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The Google Drive request failed.");
      return result as { uploadUrl?: string; folder?: ContractFolder; file?: ContractFile; files?: ContractFile[] };
    },
    [session],
  );

  const refresh = useCallback(async () => {
    if (!current) return;
    const result = await request({ action: "list-files", folderId: current.id });
    setFiles(result.files || []);
  }, [current, request]);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not list the contract files."));
  }, [refresh]);

  async function uploadOne(file: File) {
    const prepared = await request({
      action: "prepare-upload",
      projectId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (!prepared.uploadUrl || !prepared.folder) throw new Error("Google Drive did not open an upload session.");
    if (!current) {
      setCurrent(prepared.folder);
      onLinked(prepared.folder);
    }
    // Single-chunk resumable upload; the completion response is the file.
    const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
    headers["Content-Range"] = file.size ? `bytes 0-${file.size - 1}/${file.size}` : "bytes */0";
    const response = await fetch(prepared.uploadUrl, { method: "PUT", headers, body: file.size ? file : new Blob([]) });
    if (!response.ok) throw new Error(`“${file.name}” could not be uploaded (${response.status}).`);
    const uploaded = (await response.json().catch(() => ({}))) as { id?: string };
    if (uploaded.id) {
      const confirmed = await request({ action: "confirm-upload", projectId, fileId: uploaded.id });
      if (confirmed.file) setFiles((list) => [...(list || []).filter((f) => f.id !== confirmed.file!.id), confirmed.file!]);
    }
  }

  async function uploadAll(list: FileList | File[]) {
    const queue = Array.from(list);
    if (!queue.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    setPending(queue.map((f) => f.name));
    const failures: string[] = [];
    for (const file of queue) {
      try {
        await uploadOne(file);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      } finally {
        setPending((names) => names.filter((n) => n !== file.name));
      }
    }
    setBusy(false);
    if (failures.length) setError(failures.join(" · "));
    else setMessage(queue.length > 1 ? `${queue.length} files uploaded to Drive.` : "File uploaded to Drive.");
  }

  async function remove(file: ContractFile) {
    if (!confirm(`Move “${file.name}” to the Drive trash?`)) return;
    setBusy(true);
    setError("");
    try {
      await request({ action: "delete-file", fileId: file.id });
      setFiles((list) => (list || []).filter((f) => f.id !== file.id));
      setMessage(`“${file.name}” moved to the Drive trash.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void uploadAll(e.dataTransfer.files);
  };

  return (
    <div className="pc-section">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      {title ? (
        <div className="pc-head">
          <h2 className="pc-title">{title}</h2>
          {current?.webViewLink && (
            <a
              className="pc-folder-open"
              href={current.webViewLink}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} />
              Open in Drive
            </a>
          )}
        </div>
      ) : null}

      {(current || !title) && (
        <div className="pc-folder">
          <FolderOpen size={16} aria-hidden="true" />
          {current && (
            <span className="pc-folder-name" title={current.name}>
              {current.name}
            </span>
          )}
          {!title && current?.webViewLink && (
            <a
              className="pc-folder-open"
              href={current.webViewLink}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
              Open in Drive
            </a>
          )}
        </div>
      )}

      <div
        className={`pc-drop${busy ? " is-busy" : ""}`}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <Upload size={18} aria-hidden="true" />
        <span className="pc-drop-main">
          {busy ? "Uploading…" : "Drop the signed contract"}
        </span>
        <span className="pc-drop-sub">
          or click to browse · saved to Google Drive, one folder per contract.
          Annexes attach to each extension.
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void uploadAll(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {!!pending.length && (
        <ul className="pc-pending" aria-label="Uploading">
          {pending.map((name) => (
            <li key={name}>{name} — uploading…</li>
          ))}
        </ul>
      )}

      {current && (
        <div className="pc-files">
          <div className="pc-files-head">
            <h3>Files {files ? `(${files.length})` : ""}</h3>
            <button type="button" className="pc-refresh" onClick={() => void refresh()} disabled={busy}>
              Refresh
            </button>
          </div>
          {files === null && <p className="pc-muted">Loading…</p>}
          {files !== null && !files.length && (
            <p className="pc-muted">No files yet — upload the signed contract and its annexes above.</p>
          )}
          {!!files?.length && (
            <ul className="pc-file-list">
              {files.map((file) => (
                <li key={file.id} className="pc-file">
                  <FileText size={16} aria-hidden="true" />
                  <span className="pc-file-name" title={file.name}>
                    {file.webViewLink ? (
                      <a href={file.webViewLink} target="_blank" rel="noreferrer">
                        {file.name}
                      </a>
                    ) : (
                      file.name
                    )}
                  </span>
                  <span className="pc-file-meta">{formatBytes(file.size)}</span>
                  <span className="pc-file-meta">
                    {file.modifiedTime
                      ? new Date(file.modifiedTime).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="pc-file-delete"
                    aria-label={`Delete ${file.name}`}
                    title="Move to the Drive trash"
                    disabled={busy}
                    onClick={() => void remove(file)}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
