import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Eye, FileText, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { errorMessage, type DocumentAlert, type DocumentRecord, type DocumentTypeRecord } from "@quicksort/hr-db";
import { DateField } from "../DateField";
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
import "./documents.css";
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

  return (
    <div className="doc-panel">
      {(title || (folderLink && !checklist.length)) && (
        <div className="doc-head">
          {title && <h2 className="doc-title">{title}</h2>}
          {folderLink && (
            <a className="doc-link" href={folderLink} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              Open in Drive
            </a>
          )}
        </div>
      )}
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      {!!checklist.length && (
        <div className="doc-summary">
          <div className="doc-summary-top">
            <div className="doc-summary-counts">
              <span className="doc-count">{filedCount} of {checklistRows.length} filed</span>
              <span className="doc-muted">{summaryParts.join(" · ") || "All required documents filed"}</span>
            </div>
            {folderLink && (
              <a className="doc-link" href={folderLink} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                Open in Drive
              </a>
            )}
          </div>
          <div className="doc-segments" role="img" aria-label={`${filedCount} of ${checklistRows.length} required documents filed`}>
            {checklistRows.map(row => (
              <span key={row.key} className={`doc-segment${row.doc ? " is-filed" : uploadByRowKey.has(row.key) ? " is-uploading" : ""}`} />
            ))}
          </div>
        </div>
      )}

      {!!missing.length && (
        <ul className="doc-missing" aria-label="Missing documents">
          {missing.map(alert => (
            <li key={`${alert.type_code}-${alert.extension_id || ""}`}>
              <span className="doc-pill doc-pill--missing">Missing</span>
              <span className="doc-missing-name">{alert.title}</span>
              <button type="button" className="doc-text-button" disabled={busy}
                onClick={() => pick({ typeCode: alert.type_code, extensionId: alert.extension_id || undefined })}>
                Upload
              </button>
            </li>
          ))}
        </ul>
      )}

      {!!checklistRows.length && (
        <div className="doc-rows">
          {unmatchedUploads.map(upload => (
            <UploadingRow key={upload.key} fileName={upload.fileName} progress={upload.progress} onCancel={() => cancelUpload(upload.key)} />
          ))}
          {checklistRows.map(row => {
            const pending = uploadByRowKey.get(row.key);
            return pending ? (
              <UploadingRow key={row.key} fileName={pending.fileName} progress={pending.progress} onCancel={() => cancelUpload(pending.key)} />
            ) : (
              <DocumentRow
                key={row.key}
                row={row}
                busy={busy}
                onPreview={() => row.doc && setPreviewId(row.doc.id)}
                onDownload={() => row.doc && void downloadDocument(row.doc).catch(e => setError(errorMessage(e)))}
                onPick={pick}
                onClassify={() => row.doc && setDraft({ mode: "classify", file: { name: row.doc.file_name }, typeCode: defaultType, doc: row.doc })}
                onArchive={() => row.doc && confirm(`Archive “${row.doc.title}”? It leaves the active list; the file stays in storage.`) &&
                  void run("Document archived.", () => updateDocument(row.doc!.id, { status: "archived" }))}
              />
            );
          })}
        </div>
      )}

      {!checklistRows.length && !!uploadList.length && (
        <div className="doc-rows">
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
          className={`doc-drop${busy ? " is-busy" : ""}`}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => !busy && pick({ typeCode: defaultType })}
          disabled={busy}
        >
          <span className="doc-drop-icon" aria-hidden="true">
            <Upload size={18} />
          </span>
          <span className="doc-drop-main">{busy ? "Working…" : "Drop a document or click to browse"}</span>
          <span className="doc-drop-sub">You choose its type and validity next → PDF, JPG or PNG, up to 10 MB</span>
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

      {docs === null && <p className="doc-muted">Loading…</p>}
      {docs !== null && !active.length && !missing.length && !checklist.length && <p className="doc-muted">No documents filed yet.</p>}

      {extraSections.map(section => (
        <section key={section.title} className="doc-group">
          <h3 className="doc-group-title">{section.title}</h3>
          <div className="doc-rows">
            {section.rows.map(row => (
              <DocumentRow
                key={row.key}
                row={row}
                busy={busy}
                onPreview={() => row.doc && setPreviewId(row.doc.id)}
                onDownload={() => row.doc && void downloadDocument(row.doc).catch(e => setError(errorMessage(e)))}
                onPick={pick}
                onClassify={() => row.doc && setDraft({ mode: "classify", file: { name: row.doc.file_name }, typeCode: defaultType, doc: row.doc })}
                onArchive={() => row.doc && confirm(`Archive “${row.doc.title}”? It leaves the active list; the file stays in storage.`) &&
                  void run("Document archived.", () => updateDocument(row.doc!.id, { status: "archived" }))}
              />
            ))}
          </div>
        </section>
      ))}

      {groups.map(group => (
        <section key={group.folder} className="doc-group">
          <h3 className="doc-group-title">{FOLDER_TITLES[group.folder] ?? group.folder}</h3>
          <div className="doc-rows">
            {group.docs.map(doc => {
              const row = rowFor(doc);
              return (
                <DocumentRow
                  key={row.key}
                  row={row}
                  busy={busy}
                  onPreview={() => setPreviewId(doc.id)}
                  onDownload={() => void downloadDocument(doc).catch(e => setError(errorMessage(e)))}
                  onPick={pick}
                  onClassify={() => setDraft({ mode: "classify", file: { name: doc.file_name }, typeCode: defaultType, doc })}
                  onArchive={() => confirm(`Archive “${doc.title}”? It leaves the active list; the file stays in storage.`) &&
                    void run("Document archived.", () => updateDocument(doc.id, { status: "archived" }))}
                />
              );
            })}
          </div>
        </section>
      ))}

      {!!activity.length && (
        <section className="doc-activity">
          <h3 className="doc-activity-title">Recent activity</h3>
          <div className="doc-activity-card">
            {activity.map((event, index) => {
              const target = byId.get(event.next_state);
              const what = event.kind === "document_registered"
                ? `uploaded ${target?.file_name || event.rationale || "a document"}`
                : `viewed ${target?.file_name || "a document"}`;
              return (
                <div key={event.id} className="doc-activity-row" style={index ? { borderTop: "1px solid var(--qs-line)" } : undefined}>
                  <span className="doc-activity-dot" aria-hidden="true" />
                  <span className="doc-activity-what">
                    <strong>{event.actor_email || "HR"}</strong> {what}
                  </span>
                  <span className="doc-activity-when">{formatDateTime(event.created_at)}</span>
                </div>
              );
            })}
          </div>
          <p className="doc-muted">Every view and download is logged.</p>
        </section>
      )}

      {!!unfiled.length && !draft && (
        <section className="doc-group">
          <h3 className="doc-group-title">In Drive, not filed yet ({unfiled.length})</h3>
          <p className="doc-muted">Uploaded before typed documents existed. Filing moves each file into its folder and tracks its validity.</p>
          <ul className="doc-list">
            {unfiled.map(file => (
              <li key={file.id} className="doc-row">
                <FileText size={15} aria-hidden="true" className="doc-row-icon" />
                <div className="doc-row-main">
                  <span className="doc-row-title">
                    {file.link ? <a href={file.link} target="_blank" rel="noreferrer">{file.name}</a> : file.name}
                  </span>
                </div>
                <button type="button" className="doc-text-button" disabled={busy}
                  onClick={() => setDraft({ mode: "existing", file, typeCode: defaultType })}>
                  File as…
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!history.length && (
        <section className="doc-group">
          <button type="button" className="doc-text-button" onClick={() => setShowHistory(open => !open)} aria-expanded={showHistory}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
          {showHistory && (
            <ul className="doc-list doc-list--history">
              {history.map(doc => (
                <li key={doc.id} className="doc-row">
                  <div className="doc-row-main">
                    <span className="doc-row-title">{doc.title}</span>
                    <span className="doc-row-meta">
                      {typeOf.get(doc.type_code)?.label || doc.type_code} · {doc.status === "superseded" ? "replaced" : "archived"} · filed {formatDay(doc.created_at.slice(0, 10))}
                    </span>
                  </div>
                  <button type="button" className="doc-icon-button" title="Download" aria-label={`Download ${doc.title}`}
                    onClick={() => void downloadDocument(doc).catch(e => setError(errorMessage(e)))}>
                    <Download size={15} />
                  </button>
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
    </div>
  );
}

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
    <div className="doc-rowline">
      <button
        type="button"
        className="doc-identity"
        onClick={doc ? onPreview : () => onPick({ typeCode: row.typeCode, supersedes: row.supersedes })}
        aria-label={doc ? `Preview ${row.name}` : `Upload ${row.name}`}
      >
        <span className={`doc-medallion doc-medallion--${state}`} aria-hidden="true">
          {state === "filed" && <Check size={15} strokeWidth={2.2} />}
          {(state === "expiring" || state === "expired") && <Clock size={15} strokeWidth={1.75} />}
        </span>
        <span className="doc-identity-text">
          <span className="doc-row-name">{row.name}</span>
          <span className="doc-row-hint">{[row.hint, row.context].filter(Boolean).join(" · ")}</span>
        </span>
      </button>

      <div className="doc-file">
        {doc ? (
          <>
            <span className="doc-ext" aria-hidden="true">{(doc.file_name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>
            <span className="doc-file-text">
              <span className="doc-file-name" title={doc.file_name}>{doc.file_name}</span>
              <span className="doc-file-meta">{meta}</span>
            </span>
          </>
        ) : (
          <span className="doc-file-meta">{row.supersedes ? "Renewal keeps the previous version in history." : "Not filed yet"}</span>
        )}
      </div>

      <div className="doc-status">
        {doc ? (
          state === "filed" ? (
            row.needsReview
              ? <span className="doc-pill doc-pill--missing">To classify</span>
              : <span className="doc-pill">Verified</span>
          ) : state === "expiring" ? (
            <span className="doc-pill doc-pill--expiring">{expiryLabel(type)}</span>
          ) : (
            <span className="doc-pill doc-pill--expired">{expiryLabel(type)}</span>
          )
        ) : (
          <span className="doc-pill doc-pill--missing">Missing</span>
        )}
      </div>

      <div className="doc-actions">
        {doc ? (
          <>
            <button type="button" className="doc-icon-button" title="Preview" aria-label={`Preview ${row.name}`} disabled={busy} onClick={onPreview}>
              <Eye size={16} />
            </button>
            <button type="button" className="doc-icon-button" title="Download" aria-label={`Download ${row.name}`} disabled={busy} onClick={onDownload}>
              <Download size={16} />
            </button>
            <button type="button" className="doc-icon-button" title="Renew with a new file" aria-label={`Renew ${row.name}`} disabled={busy}
              onClick={() => onPick({ typeCode: doc.type_code, supersedes: doc })}>
              <RefreshCw size={16} />
            </button>
            {row.needsReview && (
              <button type="button" className="doc-text-button" disabled={busy} onClick={onClassify}>Classify</button>
            )}
            <button type="button" className="doc-icon-button" title="Archive (the file stays in Drive)" aria-label={`Archive ${row.name}`} disabled={busy} onClick={onArchive}>
              <Archive size={16} />
            </button>
          </>
        ) : (
          <button type="button" className="doc-upload" disabled={busy}
            onClick={() => onPick({ typeCode: row.typeCode, supersedes: row.supersedes })}>
            <Upload size={15} aria-hidden="true" />
            {row.supersedes ? "Renew" : "Upload"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The uploading state of a row: spinner medallion, live progress, cancel. */
function UploadingRow({ fileName, progress, onCancel }: { fileName: string; progress: number; onCancel: () => void }) {
  return (
    <div className="doc-rowline">
      <div className="doc-identity doc-identity--static">
        <span className="doc-medallion doc-medallion--uploading" aria-hidden="true">
          <Loader2 size={18} strokeWidth={1.5} />
        </span>
        <span className="doc-identity-text">
          <span className="doc-row-name">Uploading…</span>
          <span className="doc-row-hint">Filing starts as soon as the bytes land</span>
        </span>
      </div>
      <div className="doc-file">
        <div className="doc-upload-track">
          <div className="doc-upload-line">
            <span className="doc-file-name" title={fileName}>{fileName}</span>
            <span className="doc-upload-pct">{progress}%</span>
          </div>
          <div className="doc-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${fileName}`}>
            <span className="doc-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="doc-status">
        <span className="doc-pill doc-pill--uploading">Uploading</span>
      </div>
      <div className="doc-actions">
        <button type="button" className="doc-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** In-app preview: viewer on the left, details and actions on the right. */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inlineFile = file && "url" in file && (file.mime === "application/pdf" || file.mime.startsWith("image/")) ? file : null;

  return (
    <div className="doc-preview">
      <button type="button" tabIndex={-1} aria-label="Close preview" className="doc-preview-backdrop" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Preview of ${doc.title}`} className="doc-preview-dialog">
        <div className="doc-preview-viewer">
          <div className="doc-preview-toolbar">
            <span className="doc-preview-ext" aria-hidden="true">{ext}</span>
            <span className="doc-preview-file" title={doc.file_name}>{doc.file_name}</span>
            <span className="doc-preview-tools">
              <button type="button" className="doc-icon-button" aria-label="Open in a new tab"
                onClick={() => void previewDocument(doc)}>
                <ExternalLink size={15} />
              </button>
            </span>
          </div>
          <div className="doc-preview-stage">
            {loading && <span className="doc-preview-loading">Loading the document…</span>}
            {!loading && inlineFile && (inlineFile.mime === "application/pdf"
              ? <iframe title={`Preview of ${doc.file_name}`} src={inlineFile.url} className="doc-preview-frame" />
              : <img src={inlineFile.url} alt={`Preview of ${doc.file_name}`} className="doc-preview-image" />)}
            {!loading && !inlineFile && (
              <div className="doc-preview-fallback">
                <p>{file && "link" in file ? "This file is too large to preview inline." : "This file cannot be previewed inline."}</p>
                <button type="button" className="doc-upload" onClick={() => void previewDocument(doc)}>
                  <ExternalLink size={15} aria-hidden="true" />
                  Open in a new tab
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="doc-preview-details">
          <div className="doc-preview-head">
            <div className="doc-preview-title">
              <h2>{doc.title}</h2>
              {state.tone === "valid" || state.tone === "none"
                ? <span className="doc-pill">Verified</span>
                : state.tone === "expiring"
                  ? <span className="doc-pill doc-pill--expiring">{expiryLabel(state)}</span>
                  : <span className="doc-pill doc-pill--expired">{expiryLabel(state)}</span>}
            </div>
            <button type="button" className="doc-icon-button" aria-label="Close preview" onClick={onClose}>
              <X size={17} />
            </button>
          </div>

          {state.tone === "expiring" && (
            <p className="doc-preview-note">
              Ask the employee for a renewed {type?.label || "document"} before it lapses — an employment cannot run without a valid one.
            </p>
          )}

          <dl className="doc-preview-facts">
            <dt>File</dt><dd>{doc.file_name}</dd>
            <dt>Size</dt><dd>{formatBytes(doc.size_bytes) || "—"}</dd>
            <dt>Uploaded</dt><dd>{formatDay(doc.created_at.slice(0, 10))}</dd>
            <dt>Validity</dt><dd>{doc.expires_on ? `Valid until ${formatDay(doc.expires_on)}` : "No expiry"}</dd>
            <dt>Stored in</dt><dd>{doc.owner_kind === "person" ? "HR-only Drive folder" : "Drive folder"}</dd>
          </dl>

          <div className="doc-preview-actions">
            <button type="button" className="doc-upload" onClick={() => void downloadDocument(doc).catch(() => undefined)}>
              <Download size={15} aria-hidden="true" />
              Download
            </button>
            <button type="button" className="doc-ghost" onClick={() => onRenew(doc)}>
              <RefreshCw size={14} aria-hidden="true" />
              Renew
            </button>
          </div>
          {doc.owner_kind === "person" && <p className="doc-muted">Viewing is logged in the access log.</p>}

          <div className="doc-preview-nav">
            <button type="button" className="doc-ghost" disabled={index <= 0} onClick={() => onNavigate(docs[index - 1].id)}>
              <ChevronLeft size={15} aria-hidden="true" />
              Previous
            </button>
            <span>{index + 1} of {docs.length}</span>
            <button type="button" className="doc-ghost" disabled={index >= docs.length - 1} onClick={() => onNavigate(docs[index + 1].id)}>
              Next
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
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
      className="doc-form"
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
      <p className="doc-form-file">
        <FileText size={14} aria-hidden="true" />
        <span title={draft.file.name}>{draft.file.name}</span>
        {draft.supersedes && <span className="doc-muted">replaces “{draft.supersedes.title}”</span>}
      </p>
      <label className="doc-field">
        <span>Type</span>
        <TypeSearchField types={types} value={typeCode} disabled={!!draft.supersedes} onChange={setTypeCode} />
      </label>
      <label className="doc-field">
        <span>Title</span>
        <input data-field="title" aria-required="true" maxLength={200}
          onInput={e => e.currentTarget.setCustomValidity("")}
          defaultValue={draft.supersedes?.title || (draft.mode === "classify" && !draft.doc.title.includes("à classer") ? draft.doc.title : baseName(draft.file.name))} />
      </label>
      {linked && !!contracts.length && (
        <label className="doc-field">
          <span>Attached to</span>
          <select data-field="parent"defaultValue={draft.supersedes?.parent_document_id || mainContract?.id || ""}>
            <option value="">Not attached</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
      {typeCode === "AVENANT" && !!extensions.length && (
        <label className="doc-field">
          <span>Extension</span>
          <select data-field="extension"defaultValue={draft.extensionId || draft.supersedes?.extension_id || ""}>
            <option value="">None</option>
            {extensions.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      )}
      {readingDates && <p className="doc-muted">Reading the dates off the document…</p>}
      {datesRead && <p className="doc-muted">Dates read from the document — check them against the paper copy.</p>}
      <div className="doc-field-row">
        <label className="doc-field">
          <span>Issued on</span>
          <DateField value={issuedOn} onChange={setIssuedOn} aria-label="Issued on" />
        </label>
        <label className="doc-field">
          <span>Expires on{type?.requires_expiry ? " *" : ""}</span>
          <DateField value={expiresOn} min={issuedOn || undefined} aria-label="Expires on"
            onChange={next => { setExpiryTouched(true); setExpiresOn(next); }} />
        </label>
      </div>
      {type?.default_validity_months && !expiryTouched && (
        <p className="doc-muted">Expiry suggested from a {type.default_validity_months >= 12 && type.default_validity_months % 12 === 0 ? `${type.default_validity_months / 12}-year` : `${type.default_validity_months}-month`} validity — adjust it to the date on the document.</p>
      )}
      <label className="doc-field">
        <span>Notes</span>
        <input data-field="notes" maxLength={2000} />
      </label>
      <div className="doc-form-actions">
        <button type="button" className="doc-text-button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" onClick={submit} className="doc-primary"disabled={busy || (type?.requires_expiry && !expiresOn)}>
          {busy ? "Saving…" : draft.mode === "classify" ? "Save type" : draft.mode === "existing" ? "File document" : draft.supersedes ? "Upload renewal" : "Upload"}
        </button>
      </div>
    </div>
  );
}
