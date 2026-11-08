import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Eye, FileText, Loader2, RefreshCw, Upload, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Field,
  FieldLabel,
  FieldTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Progress,
} from "@quicksort-sas/ui";
import { cn } from "cn";
import { errorMessage, type DocumentAlert, type DocumentRecord, type DocumentTypeRecord } from "@quicksort/hr-db";
import { DateField } from "../DateField";
import { PageAlerts } from "../ui";
import {
  DOCUMENTS_CHANGED,
  downloadDocument,
  expiryLabel,
  expiryState,
  fetchDocumentFile,
  fileExisting,
  formatBytes,
  formatDateTime,
  formatDay,
  listUnfiled,
  loadAlerts,
  loadDocumentActivity,
  loadDocumentTypes,
  loadOwnerDocuments,
  extractDocumentDates,
  loadOwnerFolderLink,
  notifyDocumentsChanged,
  previewDocument,
  suggestedExpiry,
  updateDocument,
  uploadDocument,
  type DocumentActivityEvent,
  type DocumentMetadata,
  type DocumentOwner,
  type UnfiledFile,
} from "./client";
import { TypeSearchField } from "./TypeSearchField";

/**
 * Typed documents of one owner (project, client or person). Employee owners
 * with requirements get the Documents checklist design: a “N of M filed”
 * summary with one progress segment per requirement, rows carrying a status
 * medallion, the filed file and its validity, an in-app preview, the audit
 * trail (hr_events) and a drop zone. Other owners keep the folder grouping
 * with the same row chrome. Files go to storage through /api/documents; the
 * registry row says what they are.
 */
export type ExtensionOption = { id: string; label: string };

type Draft =
  | { mode: "upload"; file: File; typeCode: string; supersedes?: DocumentRecord; extensionId?: string }
  | { mode: "existing"; file: UnfiledFile; typeCode: string; supersedes?: undefined; extensionId?: string }
  /** A registered file awaiting its real type (candidate uploads). */
  | { mode: "classify"; file: { name: string }; typeCode: string; doc: DocumentRecord; supersedes?: undefined; extensionId?: string };

const FOLDER_ORDER = ["contrat", "annexes", "commandes", "societe", "identite", "securite_sociale", "contrat_travail", "administratif", "sante", "diplomes", "justificatifs", "sortie", "divers"];
const LINKED_TYPES = new Set(["ANNEX", "AVENANT", "PURCHASE_ORDER", "EMPLOYMENT_AVENANT"]);
const baseName = (name: string) => name.replace(/\.[A-Za-z0-9]{1,8}$/, "");

type RowState = "filed" | "expiring" | "expired" | "missing";

/** One checklist row (requirement or filed document) in the list design. */
type DocRow = {
  key: string;
  name: string;
  hint?: string;
  doc?: DocumentRecord;
  state: RowState;
  /** Preset used by the upload button of a missing row. */
  typeCode: string;
  supersedes?: DocumentRecord;
  /** Extra meta chips (parent contract, extension) in generic mode. */
  context?: string;
  needsReview?: boolean;
};

export function DocumentsPanel({
  owner,
  title = "Documents",
  extensions = [],
  requirements,
  excludeTypeCodes,
  hideFiledTypeCodes,
  onChanged,
}: {
  owner: DocumentOwner;
  /** Empty hides the heading (when the host section already has one). */
  title?: string;
  /**
   * document_types.required_for tokens that apply (an employee's contract
   * type, 'non_eu'). When given, a checklist of required documents replaces
   * the alert-based missing list.
   */
  requirements?: string[];
  /** Project extensions an avenant can formalise. */
  extensions?: ExtensionOption[];
  /** Types the owner cannot file here (e.g. company documents on an employment). */
  excludeTypeCodes?: string[];
  /** Types whose filed documents are listed elsewhere (e.g. payslips have their own section). */
  hideFiledTypeCodes?: string[];
  /** Called after any upload, renewal or archive (e.g. to refresh list flags). */
  onChanged?: () => void;
}) {
  const [types, setTypes] = useState<DocumentTypeRecord[]>([]);
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const [alerts, setAlerts] = useState<DocumentAlert[]>([]);
  const [unfiled, setUnfiled] = useState<UnfiledFile[]>([]);
  const [folderLink, setFolderLink] = useState<string | null>(null);
  const [activity, setActivity] = useState<DocumentActivityEvent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploads, setUploads] = useState<Record<string, { fileName: string; typeCode: string; progress: number }>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<DocumentRecord | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingType = useRef<{ typeCode: string; supersedes?: DocumentRecord; extensionId?: string } | null>(null);
  const uploadControllers = useRef(new Map<string, AbortController>());

  const excluded = useMemo(() => new Set(excludeTypeCodes || []), [excludeTypeCodes]);
  const ownerTypes = useMemo(
    () => types.filter(t => t.owner_kinds.includes(owner.kind) && !excluded.has(t.code)),
    [types, owner.kind, excluded],
  );
  const typeOf = useMemo(() => new Map(types.map(t => [t.code, t])), [types]);

  const refresh = useCallback(async () => {
    const [nextTypes, nextDocs, nextAlerts, link] = await Promise.all([
      loadDocumentTypes(),
      loadOwnerDocuments(owner),
      loadAlerts({ kind: owner.kind, id: owner.id }),
      loadOwnerFolderLink(owner),
    ]);
    setTypes(nextTypes);
    setDocs(nextDocs);
    setAlerts(nextAlerts);
    setFolderLink(link);
    if (owner.kind === "person")
      loadDocumentActivity(owner.id).then(setActivity, () => setActivity([]));
    // Legacy files are a bonus: storage may be disconnected without blocking the registry.
    listUnfiled(owner).then(setUnfiled, () => setUnfiled([]));
  }, [owner.kind, owner.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDocs(null);
    void refresh().catch(e => setError(errorMessage(e)));
  }, [refresh]);

  // Changes made elsewhere for this owner (e.g. the photo from the person header).
  useEffect(() => {
    const onChanged = (event: Event) => {
      const changed = (event as CustomEvent<DocumentOwner>).detail;
      if (changed?.kind === owner.kind && changed.id === owner.id) void refresh().catch(() => undefined);
    };
    window.addEventListener(DOCUMENTS_CHANGED, onChanged);
    return () => window.removeEventListener(DOCUMENTS_CHANGED, onChanged);
  }, [refresh, owner.kind, owner.id]);

  const shown = (docs || []).filter(d => !hideFiledTypeCodes?.includes(d.type_code));
  const active = shown.filter(d => d.status === "active");
  const history = shown.filter(d => d.status !== "active");
  const missing = requirements ? [] : alerts.filter(a => a.severity === "missing");
  const checklist = requirements ? requiredChecklist(ownerTypes, requirements, active) : [];
  const byId = new Map((docs || []).map(d => [d.id, d]));

  const rowFor = useCallback((doc: DocumentRecord, name?: string): DocRow => {
    const type = typeOf.get(doc.type_code);
    const state = expiryState(doc, type);
    const parent = doc.parent_document_id ? byId.get(doc.parent_document_id) : undefined;
    const extension = doc.extension_id ? extensions.find(x => x.id === doc.extension_id) : undefined;
    return {
      key: doc.id,
      name: name || doc.title,
      hint: type?.label || doc.type_code,
      doc,
      state: state.tone === "expired" ? "expired" : state.tone === "expiring" ? "expiring" : "filed",
      typeCode: doc.type_code,
      supersedes: doc,
      context: [parent && `to ${parent.title}`, extension && extension.label].filter(Boolean).join(" · ") || undefined,
      needsReview: doc.needs_review,
    };
  }, [typeOf, byId, extensions]);

  // Employee checklist: one row per requirement, the filed document riding along.
  const checklistRows: DocRow[] = checklist.map(item => {
    const members = item.members;
    const sensitive = members.some(t => t.sensitive);
    if (item.doc) return { ...rowFor(item.doc, item.label), typeCode: item.typeCode, supersedes: item.doc };
    return {
      key: item.key,
      name: item.label,
      hint: `Required${sensitive ? " · every access is logged" : ""}`,
      state: "missing",
      typeCode: item.typeCode,
      supersedes: item.expired,
    };
  });
  const checklistCodes = new Set(checklist.flatMap(item => item.codes));
  const alsoFiled = checklist.length
    ? active.filter(d => !checklistCodes.has(d.type_code)).map(d => rowFor(d))
    : [];
  // Proofs (Navigo, mutuelle…) get their own section next to the checklist.
  const isJustificatif = (row: DocRow) => typeOf.get(row.typeCode)?.folder === "justificatifs";
  const extraSections = [
    { title: "Also filed", rows: alsoFiled.filter(row => !isJustificatif(row)) },
    { title: FOLDER_TITLES.justificatifs, rows: alsoFiled.filter(isJustificatif) },
  ].filter(section => section.rows.length);
  const groups = FOLDER_ORDER.map(folder => ({
    folder,
    docs: (checklist.length ? [] : active).filter(d => (typeOf.get(d.type_code)?.folder ?? "divers") === folder),
  })).filter(g => g.docs.length);
  const defaultType =
    owner.kind === "project"
      ? active.some(d => d.type_code === "CLIENT_CONTRACT") ? "ANNEX" : "CLIENT_CONTRACT"
      : checklist.find(item => item.state !== "filed")?.typeCode || ownerTypes[0]?.code || "OTHER";

  const filedCount = checklistRows.filter(r => r.doc).length;
  const uploadList = Object.entries(uploads).map(([key, upload]) => ({ key, ...upload }));
  const uploadByRowKey = new Map<string, (typeof uploadList)[number]>();
  for (const upload of uploadList) {
    const item = checklist.find(entry => entry.codes.includes(upload.typeCode));
    if (item) uploadByRowKey.set(item.key, upload);
  }
  const unmatchedUploads = uploadList.filter(upload => !checklist.some(entry => entry.codes.includes(upload.typeCode)));
  const summaryParts = [
    checklistRows.filter(r => r.state === "missing").length ? `${checklistRows.filter(r => r.state === "missing").length} missing` : "",
    checklistRows.filter(r => r.state === "expired").length ? `${checklistRows.filter(r => r.state === "expired").length} expired` : "",
    checklistRows.filter(r => r.state === "expiring").length ? `${checklistRows.filter(r => r.state === "expiring").length} expiring soon` : "",
    uploadList.length ? `${uploadList.length} uploading` : "",
  ].filter(Boolean);

  function pick(next: { typeCode: string; supersedes?: DocumentRecord; extensionId?: string }) {
    pendingType.current = next;
    inputRef.current?.click();
  }

  function startUpload(file: File) {
    const preset = pendingType.current;
    pendingType.current = null;
    setError("");
    setDraft({ mode: "upload", file, typeCode: preset?.typeCode || defaultType, supersedes: preset?.supersedes, extensionId: preset?.extensionId });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && !busy) startUpload(file);
  };

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(label);
      await refresh();
      onChanged?.();
      notifyDocumentsChanged(owner);
    } catch (e) {
      // A cancelled upload is not an error — the row simply disappears.
      if (e instanceof DOMException && e.name === "AbortError") setMessage("Upload cancelled.");
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Abort an in-flight byte upload; the unregistered file is never filed. */
  function cancelUpload(key: string) {
    uploadControllers.current.get(key)?.abort();
  }

  async function submit(meta: DocumentMetadata) {
    if (!draft) return;
    const current = draft;
    await run(current.supersedes ? "Document renewed — the previous version is kept in history." : current.mode === "classify" ? "Document classified." : "Document filed.", async () => {
      if (current.mode === "upload") {
        const key = crypto.randomUUID();
        const controller = new AbortController();
        uploadControllers.current.set(key, controller);
        setUploads(prev => ({ ...prev, [key]: { fileName: current.file.name, typeCode: meta.typeCode, progress: 0 } }));
        setDraft(null);
        try {
          await uploadDocument(owner, current.file, meta, pct =>
            setUploads(prev => (prev[key] ? { ...prev, [key]: { ...prev[key], progress: pct } } : prev)), controller.signal);
        } finally {
          uploadControllers.current.delete(key);
          setUploads(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }
      }
      else if (current.mode === "existing") await fileExisting(owner, current.file.id, meta);
      else
        await updateDocument(current.doc.id, {
          type_code: meta.typeCode,
          needs_review: false,
          title: meta.title,
          issued_on: meta.issuedOn ?? null,
          expires_on: meta.expiresOn ?? null,
          parent_document_id: meta.parentDocumentId ?? null,
          notes: meta.notes || current.doc.notes,
        });
      setDraft(null);
    });
  }

  const previewDoc = previewId ? byId.get(previewId) : undefined;
  const askArchive = (doc: DocumentRecord) => setArchiveTarget(doc);
  const rowHandlers = (doc: DocumentRecord | undefined) => ({
    onPreview: () => doc && setPreviewId(doc.id),
    onDownload: () => doc && void downloadDocument(doc).catch(e => setError(errorMessage(e))),
    onClassify: () => doc && setDraft({ mode: "classify", file: { name: doc.file_name }, typeCode: defaultType, doc }),
    onArchive: () => doc && askArchive(doc),
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {(title || (folderLink && !checklist.length)) && (
        <div className="flex items-baseline justify-between gap-3">
          {title && <h2 className="m-0 text-lg font-medium tracking-tight text-foreground">{title}</h2>}
          {folderLink && <DriveLink href={folderLink} />}
        </div>
      )}
      <PageAlerts error={error} message={message} />

      {!!checklist.length && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-heading text-[32px] leading-none tracking-[-0.03em] text-foreground">{filedCount} of {checklistRows.length} filed</span>
              <span className="text-[13px] text-muted-foreground">{summaryParts.join(" · ") || "All required documents filed"}</span>
            </div>
            {folderLink && <DriveLink href={folderLink} />}
          </div>
          <div className="flex gap-1" role="img" aria-label={`${filedCount} of ${checklistRows.length} required documents filed`}>
            {checklistRows.map(row => (
              <span key={row.key} className={cn("h-1.5 flex-1 rounded-full bg-border", row.doc ? "bg-pivot" : uploadByRowKey.has(row.key) && "bg-foreground/40")} />
            ))}
          </div>
        </div>
      )}

      {!!missing.length && (
        <ul className="m-0 flex list-none flex-col gap-2 rounded-lg border border-dashed border-input px-3 py-2.5" aria-label="Missing documents">
          {missing.map(alert => (
            <li key={`${alert.type_code}-${alert.extension_id || ""}`} className="flex items-center gap-2 text-[13px]">
              <StatusBadge state="missing">Missing</StatusBadge>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{alert.title}</span>
              <Button variant="link" size="sm" className="h-auto px-0" disabled={busy}
                onClick={() => pick({ typeCode: alert.type_code, extensionId: alert.extension_id || undefined })}>
                Upload
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!!checklistRows.length && (
        <div className={ROWS}>
          {unmatchedUploads.map(upload => (
            <UploadingRow key={upload.key} fileName={upload.fileName} progress={upload.progress} onCancel={() => cancelUpload(upload.key)} />
          ))}
          {checklistRows.map(row => {
            const pending = uploadByRowKey.get(row.key);
            return pending ? (
              <UploadingRow key={row.key} fileName={pending.fileName} progress={pending.progress} onCancel={() => cancelUpload(pending.key)} />
            ) : (
              <DocumentRow key={row.key} row={row} busy={busy} onPick={pick} {...rowHandlers(row.doc)} />
            );
          })}
        </div>
      )}

      {!checklistRows.length && !!uploadList.length && (
        <div className={ROWS}>
          {uploadList.map(upload => (
            <UploadingRow key={upload.key} fileName={upload.fileName} progress={upload.progress} onCancel={() => cancelUpload(upload.key)} />
          ))}
        </div>
      )}

      {draft ? (
        <DocumentForm
          key={`${draft.mode}-${draft.file.name}-${draft.supersedes?.id || ""}`}
          draft={draft}
          types={draft.supersedes ? ownerTypes.filter(t => t.code === draft.supersedes!.type_code) : ownerTypes}
          contracts={active.filter(d => !LINKED_TYPES.has(d.type_code))}
          extensions={extensions}
          busy={busy}
          onCancel={() => setDraft(null)}
          onSubmit={submit}
        />
      ) : (
        <button
          type="button"
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-input bg-card p-6 text-center text-foreground outline-none transition-colors",
            "hover:border-foreground/40 hover:bg-accent focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/15",
            "disabled:cursor-wait disabled:opacity-60",
          )}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => !busy && pick({ typeCode: defaultType })}
          disabled={busy}
        >
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent" aria-hidden="true">
            <Upload className="size-[18px]" />
          </span>
          <span className="text-[15px] font-medium">{busy ? "Working…" : "Drop a document or click to browse"}</span>
          <span className="text-[13px] text-muted-foreground">You choose its type and validity next → PDF, JPG or PNG, up to 10 MB</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) startUpload(file);
          e.target.value = "";
        }}
      />

      {docs === null && <p role="status" className={MUTED}>Loading…</p>}
      {docs !== null && !active.length && !missing.length && !checklist.length && <p className={MUTED}>No documents filed yet.</p>}

      {extraSections.map(section => (
        <section key={section.title} className="flex flex-col gap-1.5">
          <h3 className={GROUP_TITLE}>{section.title}</h3>
          <div className={ROWS}>
            {section.rows.map(row => (
              <DocumentRow key={row.key} row={row} busy={busy} onPick={pick} {...rowHandlers(row.doc)} />
            ))}
          </div>
        </section>
      ))}

      {groups.map(group => (
        <section key={group.folder} className="flex flex-col gap-1.5">
          <h3 className={GROUP_TITLE}>{FOLDER_TITLES[group.folder] ?? group.folder}</h3>
          <div className={ROWS}>
            {group.docs.map(doc => {
              const row = rowFor(doc);
              return <DocumentRow key={row.key} row={row} busy={busy} onPick={pick} {...rowHandlers(doc)} />;
            })}
          </div>
        </section>
      ))}

      {!!activity.length && (
        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-sm font-medium text-foreground">Recent activity</h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0">
            {activity.map(event => {
              const target = byId.get(event.next_state);
              const what = event.kind === "document_registered"
                ? `uploaded ${target?.file_name || event.rationale || "a document"}`
                : `viewed ${target?.file_name || "a document"}`;
              return (
                <li key={event.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
                  <span className="size-1.5 flex-none rounded-full bg-faint" aria-hidden="true" />
                  <span className="min-w-[12rem] flex-1 truncate text-muted-foreground">
                    <strong className="font-medium text-foreground">{event.actor_email || "HR"}</strong> {what}
                  </span>
                  <span className="flex-none text-muted-foreground tabular-nums">{formatDateTime(event.created_at)}</span>
                </li>
              );
            })}
          </ul>
          <p className={MUTED}>Every view and download is logged.</p>
        </section>
      )}

      {!!unfiled.length && !draft && (
        <section className="flex flex-col gap-1.5">
          <h3 className={GROUP_TITLE}>In Drive, not filed yet ({unfiled.length})</h3>
          <p className={MUTED}>Uploaded before typed documents existed. Filing moves each file into its folder and tracks its validity.</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {unfiled.map(file => (
              <li key={file.id} className="flex min-w-0 items-center gap-2 border-t border-border py-2">
                <FileText aria-hidden="true" className="size-[15px] flex-none text-faint" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {file.link ? <a href={file.link} target="_blank" rel="noreferrer" className="text-inherit underline-offset-4 hover:underline">{file.name}</a> : file.name}
                </span>
                <Button variant="link" size="sm" className="h-auto px-0" disabled={busy}
                  onClick={() => setDraft({ mode: "existing", file, typeCode: defaultType })}>
                  File as…
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!history.length && (
        <section className="flex flex-col items-start gap-1.5">
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowHistory(open => !open)} aria-expanded={showHistory}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </Button>
          {showHistory && (
            <ul className="m-0 flex w-full list-none flex-col p-0">
              {history.map(doc => (
                <li key={doc.id} className="flex min-w-0 items-center gap-2 border-t border-border py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-muted-foreground">{doc.title}</span>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {typeOf.get(doc.type_code)?.label || doc.type_code} · {doc.status === "superseded" ? "replaced" : "archived"} · filed {formatDay(doc.created_at.slice(0, 10))}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon-sm" title="Download" aria-label={`Download ${doc.title}`}
                    onClick={() => void downloadDocument(doc).catch(e => setError(errorMessage(e)))}>
                    <Download />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          type={typeOf.get(previewDoc.type_code)}
          docs={active}
          onNavigate={setPreviewId}
          onClose={() => setPreviewId(null)}
          onRenew={doc => {
            setPreviewId(null);
            pick({ typeCode: doc.type_code, supersedes: doc });
          }}
        />
      )}

      <AlertDialog open={!!archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{archiveTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>It leaves the active list; the file stays in storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const doc = archiveTarget;
                setArchiveTarget(null);
                if (doc) void run("Document archived.", () => updateDocument(doc.id, { status: "archived" }));
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const MUTED = "m-0 text-[13px] text-muted-foreground";
const GROUP_TITLE = "m-0 text-[13px] font-medium text-muted-foreground";
const ROWS = "flex flex-col border-t border-border";

function DriveLink({ href }: { href: string }) {
  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <ExternalLink className="size-3.5" aria-hidden="true" />
      Open in Drive
    </a>
  );
}

type BadgeState = "filed" | "review" | "expiring" | "expired" | "missing" | "uploading";
const BADGE: Record<BadgeState, { variant: "secondary" | "outline" | "warning" | "destructive"; className?: string }> = {
  filed: { variant: "secondary" },
  review: { variant: "outline", className: "border-dashed" },
  expiring: { variant: "warning" },
  expired: { variant: "destructive" },
  missing: { variant: "outline", className: "border-dashed" },
  uploading: { variant: "outline" },
};

/** Row status (Verified, Expires in…, Missing…) as a package Badge. */
function StatusBadge({ state, children }: { state: BadgeState; children: ReactNode }) {
  const { variant, className } = BADGE[state];
  return <Badge variant={variant} className={className}>{children}</Badge>;
}

/** Status medallion: solid check (filed), clock ring (expiring/expired), dashed ring (missing), spinner. */
function Medallion({ state }: { state: RowState | "uploading" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 flex-none items-center justify-center rounded-full",
        state === "filed" && "bg-foreground text-background",
        state === "expiring" && "border-[1.5px] border-foreground text-foreground",
        state === "expired" && "border-[1.5px] border-destructive text-destructive",
        state === "missing" && "border-[1.5px] border-dashed border-input",
        state === "uploading" && "text-foreground",
      )}
    >
      {state === "filed" && <Check className="size-[15px]" strokeWidth={2.2} />}
      {(state === "expiring" || state === "expired") && <Clock className="size-[15px]" strokeWidth={1.75} />}
      {state === "uploading" && <Loader2 className="size-[18px] animate-spin motion-reduce:animate-none" strokeWidth={1.5} />}
    </span>
  );
}

/** File-type tile (PDF, JPG…) next to a filed document. */
function ExtTile({ fileName }: { fileName: string }) {
  return (
    <span className="inline-flex h-9 w-8 flex-none items-end justify-center rounded-md border border-border bg-muted pb-1.5 font-mono text-[9px] font-semibold tracking-[0.02em] text-muted-foreground" aria-hidden="true">
      {(fileName.split(".").pop() || "").toUpperCase().slice(0, 4)}
    </span>
  );
}

const ROW_LINE = "flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-border py-4";
const IDENTITY = "flex min-w-0 flex-[1_1_240px] items-center gap-3.5 rounded-lg py-1 text-left";

/** One row of the checklist: status medallion, identity, file, pill, actions. */
function DocumentRow({
  row,
  busy,
  onPreview,
  onDownload,
  onPick,
  onClassify,
  onArchive,
}: {
  row: DocRow;
  busy: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onPick: (next: { typeCode: string; supersedes?: DocumentRecord }) => void;
  onClassify: () => void;
  onArchive: () => void;
}) {
  const doc = row.doc;
  const state = row.state;
  const type = doc ? expiryState(doc, undefined) : { tone: "none", daysLeft: null } as const;
  const meta = doc
    ? [
        formatBytes(doc.size_bytes),
        `Uploaded ${formatDay(doc.created_at.slice(0, 10))}`,
        doc.expires_on ? `Valid until ${formatDay(doc.expires_on)}` : "No expiry",
      ].filter(Boolean).join(" · ")
    : "";
  return (
    <div className={ROW_LINE}>
      <button
        type="button"
        className={cn(IDENTITY, "group/identity cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/15")}
        onClick={doc ? onPreview : () => onPick({ typeCode: row.typeCode, supersedes: row.supersedes })}
        aria-label={doc ? `Preview ${row.name}` : `Upload ${row.name}`}
      >
        <Medallion state={state} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium text-foreground decoration-border underline-offset-4 group-hover/identity:underline">{row.name}</span>
          <span className="truncate text-[13px] text-muted-foreground">{[row.hint, row.context].filter(Boolean).join(" · ")}</span>
        </span>
      </button>

      <div className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
        {doc ? (
          <>
            <ExtTile fileName={doc.file_name} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-foreground" title={doc.file_name}>{doc.file_name}</span>
              <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{meta}</span>
            </span>
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">{row.supersedes ? "Renewal keeps the previous version in history." : "Not filed yet"}</span>
        )}
      </div>

      <div className="flex flex-none">
        {doc ? (
          state === "filed" ? (
            row.needsReview
              ? <StatusBadge state="review">To classify</StatusBadge>
              : <StatusBadge state="filed">Verified</StatusBadge>
          ) : state === "expiring" ? (
            <StatusBadge state="expiring">{expiryLabel(type)}</StatusBadge>
          ) : (
            <StatusBadge state="expired">{expiryLabel(type)}</StatusBadge>
          )
        ) : (
          <StatusBadge state="missing">Missing</StatusBadge>
        )}
      </div>

      <div className="ml-auto flex flex-none items-center justify-end gap-1">
        {doc ? (
          <>
            <Button variant="ghost" size="icon-sm" title="Preview" aria-label={`Preview ${row.name}`} disabled={busy} onClick={onPreview}>
              <Eye />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Download" aria-label={`Download ${row.name}`} disabled={busy} onClick={onDownload}>
              <Download />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Renew with a new file" aria-label={`Renew ${row.name}`} disabled={busy}
              onClick={() => onPick({ typeCode: doc.type_code, supersedes: doc })}>
              <RefreshCw />
            </Button>
            {row.needsReview && (
              <Button variant="outline" size="sm" disabled={busy} onClick={onClassify}>Classify</Button>
            )}
            <Button variant="ghost" size="icon-sm" title="Archive (the file stays in Drive)" aria-label={`Archive ${row.name}`} disabled={busy} onClick={onArchive}>
              <Archive />
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onPick({ typeCode: row.typeCode, supersedes: row.supersedes })}>
            <Upload data-icon="inline-start" aria-hidden="true" />
            {row.supersedes ? "Renew" : "Upload"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The uploading state of a row: spinner medallion, live progress, cancel. */
function UploadingRow({ fileName, progress, onCancel }: { fileName: string; progress: number; onCancel: () => void }) {
  return (
    <div className={ROW_LINE}>
      <div className={IDENTITY}>
        <Medallion state="uploading" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium text-foreground">Uploading…</span>
          <span className="truncate text-[13px] text-muted-foreground">Filing starts as soon as the bytes land</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        <div className="flex justify-between gap-3 text-[13px]">
          <span className="truncate text-foreground" title={fileName}>{fileName}</span>
          <span className="num flex-none text-muted-foreground">{progress}%</span>
        </div>
        <Progress value={progress} aria-label={`Uploading ${fileName}`} />
      </div>
      <div className="flex flex-none">
        <StatusBadge state="uploading">Uploading</StatusBadge>
      </div>
      <div className="ml-auto flex flex-none items-center justify-end gap-1">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** In-app preview (package Dialog): viewer on the left, details and actions on the right. */
function DocumentPreview({
  doc,
  type,
  docs,
  onNavigate,
  onClose,
  onRenew,
}: {
  doc: DocumentRecord;
  type: DocumentTypeRecord | undefined;
  docs: DocumentRecord[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  onRenew: (doc: DocumentRecord) => void;
}) {
  const [file, setFile] = useState<{ url: string; mime: string } | { link: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const index = docs.findIndex(d => d.id === doc.id);
  const state = expiryState(doc, type);
  const ext = (doc.file_name.split(".").pop() || "").toUpperCase().slice(0, 4);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setFile(null);
    fetchDocumentFile(doc)
      .then(result => {
        if (!alive) return;
        if (result instanceof Blob) {
          objectUrl = URL.createObjectURL(result);
          setFile({ url: objectUrl, mime: result.type });
        } else {
          setFile({ link: result.link });
        }
      })
      .catch(() => { if (alive) setFile(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const inlineFile = file && "url" in file && (file.mime === "application/pdf" || file.mime.startsWith("image/")) ? file : null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-3rem)] w-full flex-wrap gap-0 overflow-auto p-0 sm:max-w-[1040px] sm:p-0"
      >
        <div className="flex min-w-0 flex-[999_1_520px] flex-col bg-muted">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className="inline-flex h-[22px] flex-none items-center rounded-md bg-accent px-1.5 font-mono text-[10px] font-semibold text-muted-foreground" aria-hidden="true">{ext}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={doc.file_name}>{doc.file_name}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Open in a new tab" onClick={() => void previewDocument(doc)}>
              <ExternalLink />
            </Button>
          </div>
          <div className="flex min-h-[260px] flex-1 items-center justify-center px-4 py-6 sm:min-h-[420px] sm:px-6 sm:py-8">
            {loading && <span role="status" className="text-[13px] text-muted-foreground">Loading the document…</span>}
            {!loading && inlineFile && (inlineFile.mime === "application/pdf"
              ? <iframe title={`Preview of ${doc.file_name}`} src={inlineFile.url} className="h-[45vh] min-h-[260px] w-full rounded-md border-0 bg-background sm:h-[60vh] sm:min-h-[420px]" />
              : <img src={inlineFile.url} alt={`Preview of ${doc.file_name}`} className="max-h-[60vh] max-w-full rounded-md shadow-lg" />)}
            {!loading && !inlineFile && (
              <div className="flex flex-col items-center gap-3 text-center text-[13px] text-muted-foreground">
                <p className="m-0">{file && "link" in file ? "This file is too large to preview inline." : "This file cannot be previewed inline."}</p>
                <Button size="sm" onClick={() => void previewDocument(doc)}>
                  <ExternalLink data-icon="inline-start" aria-hidden="true" />
                  Open in a new tab
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-2.5">
              <DialogTitle className="text-2xl">{doc.title}</DialogTitle>
              {state.tone === "valid" || state.tone === "none"
                ? <StatusBadge state="filed">Verified</StatusBadge>
                : state.tone === "expiring"
                  ? <StatusBadge state="expiring">{expiryLabel(state)}</StatusBadge>
                  : <StatusBadge state="expired">{expiryLabel(state)}</StatusBadge>}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
              <X />
            </Button>
          </div>

          {state.tone === "expiring" && (
            <p className="m-0 rounded-xl border border-input px-3.5 py-3 text-[13px] leading-normal text-muted-foreground">
              Ask the employee for a renewed {type?.label || "document"} before it lapses — an employment cannot run without a valid one.
            </p>
          )}

          <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
            <dt className="text-muted-foreground">File</dt><dd className="m-0 text-foreground [overflow-wrap:anywhere]">{doc.file_name}</dd>
            <dt className="text-muted-foreground">Size</dt><dd className="m-0 text-foreground">{formatBytes(doc.size_bytes) || "—"}</dd>
            <dt className="text-muted-foreground">Uploaded</dt><dd className="m-0 text-foreground">{formatDay(doc.created_at.slice(0, 10))}</dd>
            <dt className="text-muted-foreground">Validity</dt><dd className="m-0 text-foreground">{doc.expires_on ? `Valid until ${formatDay(doc.expires_on)}` : "No expiry"}</dd>
            <dt className="text-muted-foreground">Stored in</dt><dd className="m-0 text-foreground">{doc.owner_kind === "person" ? "HR-only Drive folder" : "Drive folder"}</dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void downloadDocument(doc).catch(() => undefined)}>
              <Download data-icon="inline-start" aria-hidden="true" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={() => onRenew(doc)}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Renew
            </Button>
          </div>
          {doc.owner_kind === "person" && <p className={MUTED}>Viewing is logged in the access log.</p>}

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted-foreground">
            <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => onNavigate(docs[index - 1].id)}>
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              Previous
            </Button>
            <span className="num">{index + 1} of {docs.length}</span>
            <Button variant="outline" size="sm" disabled={index >= docs.length - 1} onClick={() => onNavigate(docs[index + 1].id)}>
              Next
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ChecklistItem = {
  key: string;
  label: string;
  typeCode: string;
  state: "filed" | "expired" | "missing";
  expired?: DocumentRecord;
  /** The active document satisfying the requirement, when any. */
  doc?: DocumentRecord;
  /** Every type code satisfying the requirement (drives the "also filed" split). */
  codes: string[];
  members: DocumentTypeRecord[];
};

/** One line per requirement group (CNI or passport count once), in type order. */
function requiredChecklist(types: DocumentTypeRecord[], requirements: string[], active: DocumentRecord[]): ChecklistItem[] {
  const groups = new Map<string, DocumentTypeRecord[]>();
  for (const type of types)
    if (type.required_for.some(token => requirements.includes(token))) {
      const key = type.requirement_group || type.code;
      groups.set(key, [...(groups.get(key) || []), type]);
    }
  return [...groups].map(([key, members]) => {
    const codes = new Set(members.map(t => t.code));
    const docs = active.filter(d => codes.has(d.type_code));
    const valid = docs.find(d => expiryState(d, members.find(t => t.code === d.type_code)).tone !== "expired");
    const expired = valid ? undefined : docs[0];
    return {
      key,
      label: members.map(t => t.label).join(" or "),
      typeCode: valid?.type_code || expired?.type_code || members[0].code,
      state: valid ? "filed" : expired ? "expired" : "missing",
      expired,
      doc: valid || expired,
      codes: [...codes],
      members,
    };
  });
}

const FOLDER_TITLES: Record<string, string> = {
  contrat: "Contract",
  annexes: "Annexes & avenants",
  commandes: "Purchase orders",
  societe: "Company",
  identite: "Identity",
  securite_sociale: "Social security",
  contrat_travail: "Employment",
  administratif: "Administrative",
  sante: "Medical",
  diplomes: "Degrees & certifications",
  justificatifs: "Justificatifs",
  sortie: "Exit",
  divers: "Other",
};

function DocumentForm({
  draft,
  types,
  contracts,
  extensions,
  busy,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  types: DocumentTypeRecord[];
  contracts: DocumentRecord[];
  extensions: ExtensionOption[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (meta: DocumentMetadata) => void;
}) {
  const [typeCode, setTypeCode] = useState(types.some(t => t.code === draft.typeCode) ? draft.typeCode : types[0]?.code || "");
  const type = types.find(t => t.code === typeCode);
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState(draft.supersedes ? "" : suggestedExpiry(type, null));
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [readingDates, setReadingDates] = useState(false);
  const [datesRead, setDatesRead] = useState(false);
  const linked = LINKED_TYPES.has(typeCode);
  const mainContract = contracts.find(c => c.type_code === "CLIENT_CONTRACT" || c.type_code === "EMPLOYMENT_CONTRACT");
  const uploadFile = draft.mode === "upload" ? draft.file : null;

  // Follow the type's default validity until the user picks a date themselves.
  useEffect(() => {
    if (!expiryTouched) setExpiresOn(suggestedExpiry(type, issuedOn || null));
  }, [typeCode, issuedOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh upload: read the printed dates off the file so the form starts
  // pre-filled. Failures stay silent — the user fills the dates by hand.
  useEffect(() => {
    if (!uploadFile) return;
    let alive = true;
    setReadingDates(true);
    extractDocumentDates(uploadFile)
      .then(found => {
        if (!alive || !found) return;
        if (found.issuedOn) setIssuedOn(found.issuedOn);
        if (found.expiresOn) {
          setExpiryTouched(true); // keep the printed date over the type's suggested validity
          setExpiresOn(found.expiresOn);
        }
        if (found.issuedOn || found.expiresOn) setDatesRead(true);
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setReadingDates(false); });
    return () => { alive = false; };
  }, [uploadFile]);

  // Not a <form>: the panel is rendered inside other forms (the project
  // editor's #pj-form), and a nested <form> makes the browser submit natively
  // — a full-page GET reload that loses the upload. Fields are read from the
  // root through data-field (no `name`, so they stay out of the host form's
  // FormData) and Enter is handled here instead of by implicit submission.
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  function submit() {
    const root = rootRef.current;
    if (!root || busy || (type?.requires_expiry && !expiresOn)) return;
    const field = (name: string) =>
      root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`);
    const value = (name: string) => String(field(name)?.value || "").trim();
    const titleInput = field("title") as HTMLInputElement | null;
    if (titleInput && !value("title")) {
      titleInput.setCustomValidity("Give the document a title.");
      titleInput.reportValidity();
      return;
    }
    onSubmit({
      typeCode,
      title: value("title"),
      issuedOn: issuedOn || null,
      expiresOn: expiresOn || null,
      notes: value("notes"),
      parentDocumentId: linked ? value("parent") || null : null,
      extensionId: typeCode === "AVENANT" ? value("extension") || null : null,
      supersedes: draft.supersedes?.id ?? null,
    });
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
      role="group"
      aria-label="Document details"
      onKeyDown={e => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          // Keep Enter from submitting the host form (e.g. saving the project).
          e.preventDefault();
          submit();
        }
      }}
    >
      <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">
        <FileText className="size-3.5" aria-hidden="true" />
        <span title={draft.file.name}>{draft.file.name}</span>
        {draft.supersedes && <span className="font-normal text-muted-foreground">replaces “{draft.supersedes.title}”</span>}
      </p>
      <Field className="gap-1.5">
        <FieldTitle>Type</FieldTitle>
        <TypeSearchField types={types} value={typeCode} disabled={!!draft.supersedes} onChange={setTypeCode} />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
        <Input id={`${id}-title`} data-field="title" aria-required="true" maxLength={200}
          onInput={e => e.currentTarget.setCustomValidity("")}
          defaultValue={draft.supersedes?.title || (draft.mode === "classify" && !draft.doc.title.includes("à classer") ? draft.doc.title : baseName(draft.file.name))} />
      </Field>
      {linked && !!contracts.length && (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${id}-parent`}>Attached to</FieldLabel>
          <NativeSelect id={`${id}-parent`} data-field="parent" className="w-full" defaultValue={draft.supersedes?.parent_document_id || mainContract?.id || ""}>
            <NativeSelectOption value="">Not attached</NativeSelectOption>
            {contracts.map(c => <NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
      )}
      {typeCode === "AVENANT" && !!extensions.length && (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${id}-extension`}>Extension</FieldLabel>
          <NativeSelect id={`${id}-extension`} data-field="extension" className="w-full" defaultValue={draft.extensionId || draft.supersedes?.extension_id || ""}>
            <NativeSelectOption value="">None</NativeSelectOption>
            {extensions.map(x => <NativeSelectOption key={x.id} value={x.id}>{x.label}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
      )}
      {readingDates && <p role="status" className={MUTED}>Reading the dates off the document…</p>}
      {datesRead && <p className={MUTED}>Dates read from the document — check them against the paper copy.</p>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        <Field className="gap-1.5">
          <FieldTitle>Issued on</FieldTitle>
          <DateField value={issuedOn} onChange={setIssuedOn} aria-label="Issued on" />
        </Field>
        <Field className="gap-1.5">
          <FieldTitle>Expires on{type?.requires_expiry ? " *" : ""}</FieldTitle>
          <DateField value={expiresOn} min={issuedOn || undefined} aria-label="Expires on"
            onChange={next => { setExpiryTouched(true); setExpiresOn(next); }} />
        </Field>
      </div>
      {type?.default_validity_months && !expiryTouched && (
        <p className={MUTED}>Expiry suggested from a {type.default_validity_months >= 12 && type.default_validity_months % 12 === 0 ? `${type.default_validity_months / 12}-year` : `${type.default_validity_months}-month`} validity — adjust it to the date on the document.</p>
      )}
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
        <Input id={`${id}-notes`} data-field="notes" maxLength={2000} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy || (type?.requires_expiry && !expiresOn)}>
          {busy ? "Saving…" : draft.mode === "classify" ? "Save type" : draft.mode === "existing" ? "File document" : draft.supersedes ? "Upload renewal" : "Upload"}
        </Button>
      </div>
    </div>
  );
}
