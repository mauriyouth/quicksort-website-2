import { useRef, useState, type DragEvent } from "react";
import { Check, Clock, Download, Eye, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge, Button } from "@quicksort-sas/ui";
import { cn } from "cn";
import { expiryLabel, expiryState, uploadStatus } from "./expiry";
import { TypeSearchField } from "./TypeSearchField";

/** public.my_documents: the caller's HR folder as the registry holds it. */
export type MyFiledDocument = {
  id: string; upload_path: string | null; uploaded_by_me: boolean; type_code: string; type_label: string | null;
  title: string; file_name: string; size_bytes: number | null; status: "active" | "superseded" | "archived";
  needs_review: boolean; expires_on: string | null; warn_days: number[]; created_at: string;
};
/** public.candidate_documents: the caller's own uploads. */
export type MyUpload = { id: string; name: string; category: string; storage_path: string; size_bytes: number; created_at: string; type_code?: string | null };
/** public.my_document_types: person types with the caller's requirement flag. */
export type MyDocumentType = { code: string; label: string; folder: string; requirement_group: string | null; warn_days: number[]; sensitive: boolean; position: number; required: boolean; self_upload: boolean; relevant: boolean };

type State = "filed" | "expiring" | "expired" | "missing";
type Row = {
  key: string;
  name: string;
  hint: string;
  state: State;
  pill: { label: string; tone: State };
  filed?: MyFiledDocument;
  upload?: MyUpload;
  /** Type a new file goes into (upload or renewal), when the employee may file it. */
  uploadType?: string;
};

const RESUME = "__resume";
const IDENTITY_FOLDERS = new Set(["identite"]);
const QUALIFICATION_FOLDERS = new Set(["diplomes"]);
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx";

const formatBytes = (n: number | null | undefined) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Candidate-documents category for a typed upload (drives the coarse fallback HR sees). */
export function uploadCategory(type: Pick<MyDocumentType, "folder"> | undefined) {
  if (!type) return "other";
  if (IDENTITY_FOLDERS.has(type.folder)) return "identity";
  if (QUALIFICATION_FOLDERS.has(type.folder)) return "qualification";
  return "other";
}

/**
 * The employee's HR folder in the layout of the HR person page: a "N of M
 * filed" summary over the documents their contract requires, one row per
 * requirement with its status and an upload into the missing slot, then the
 * other documents on file. HR-only tools (classify, archive, activity log)
 * stay on the admin side.
 */
export function MyDocuments({ folder, uploads, types, busy, loading, onUpload, onOpen, onDownload, onRemove }: {
  folder: MyFiledDocument[];
  uploads: MyUpload[];
  types: MyDocumentType[];
  busy: boolean;
  loading: boolean;
  onUpload: (file: File, typeCode: string | null, category: string) => void;
  onOpen: (doc: MyFiledDocument) => void;
  onDownload: (row: { filed?: MyFiledDocument; upload?: MyUpload }) => void;
  onRemove: (upload: MyUpload) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);
  const [addType, setAddType] = useState("");
  const typeOf = new Map(types.map((t) => [t.code, t]));
  const uploadByPath = new Map(uploads.map((u) => [u.storage_path, u]));
  const registeredPaths = new Set(folder.map((f) => f.upload_path).filter(Boolean));
  const active = folder.filter((f) => f.status === "active");
  // Own uploads HR has no registry row for yet (account not linked, or a CV).
  const unregistered = uploads.filter((u) => !registeredPaths.has(u.storage_path));

  const rowFor = (filed: MyFiledDocument, name?: string): Row => {
    const status = uploadStatus(filed, "");
    const type = typeOf.get(filed.type_code);
    return {
      key: filed.id,
      name: name ?? filed.title,
      hint: filed.type_label ?? filed.type_code,
      // Replaced or archived uploads lose the tick; "To classify" keeps it, as on the HR page.
      state: filed.status !== "active" ? "missing" : status.tone === "missing" ? "filed" : status.tone,
      pill: status,
      filed,
      upload: filed.upload_path ? uploadByPath.get(filed.upload_path) : undefined,
      // Outside the checklist, only the employee's own papers can be renewed from here.
      uploadType: type?.self_upload && filed.uploaded_by_me ? type.code : undefined,
    };
  };

  // One line per requirement group (CNI or passport count once), in type order.
  const groups = new Map<string, MyDocumentType[]>();
  for (const type of [...types].sort((a, b) => a.position - b.position))
    if (type.required) groups.set(type.requirement_group || type.code, [...(groups.get(type.requirement_group || type.code) || []), type]);
  const checklist: Row[] = [...groups].map(([key, members]) => {
    const codes = new Set(members.map((t) => t.code));
    const label = members.map((t) => t.label).join(" or ");
    const docs = active.filter((d) => codes.has(d.type_code));
    const valid = docs.find((d) => expiryState(d, d).tone !== "expired");
    const doc = valid ?? docs[0];
    const selfUpload = members.find((t) => t.self_upload)?.code;
    if (doc) return { ...rowFor(doc, label), uploadType: typeOf.get(doc.type_code)?.self_upload ? doc.type_code : selfUpload };
    // Sent but not in the registry yet (the account is linked later).
    const sent = unregistered.find((u) => u.type_code && codes.has(u.type_code));
    if (sent) return { key, name: label, hint: "Required", state: "filed", pill: { label: "Received", tone: "missing" }, upload: sent, uploadType: selfUpload };
    const sensitive = members.some((t) => t.sensitive);
    return { key, name: label, hint: `Required${sensitive ? " · every access is logged" : ""}`, state: "missing", pill: { label: "Missing", tone: "missing" }, uploadType: selfUpload };
  });
  const checklistCodes = new Set([...groups.values()].flat().map((t) => t.code));
  const usedUploads = new Set(checklist.map((r) => r.upload?.id).filter(Boolean));
  const others: Row[] = [
    ...active.filter((d) => !checklistCodes.has(d.type_code)).map((d) => rowFor(d)),
    // A replaced or archived own upload, while the upload itself still exists.
    ...folder.filter((f) => f.status !== "active" && f.upload_path && uploadByPath.has(f.upload_path)).map((d) => ({ ...rowFor(d), uploadType: undefined })),
    ...unregistered.filter((u) => !usedUploads.has(u.id)).map((u): Row => {
      const status = uploadStatus(undefined, u.category);
      return { key: u.id, name: u.name, hint: (u.type_code && typeOf.get(u.type_code)?.label) || u.category, state: "filed", pill: status, upload: u };
    }),
  ];
  const isJustificatif = (row: Row) => typeOf.get(row.filed?.type_code ?? row.upload?.type_code ?? "")?.folder === "justificatifs";
  const sections = [
    { title: checklist.length ? "Also on file" : "On file", rows: others.filter((r) => !isJustificatif(r)) },
    { title: "Justificatifs", rows: others.filter(isJustificatif) },
  ].filter((s) => s.rows.length);

  const filedCount = checklist.filter((r) => r.filed || r.upload).length;
  const count = (state: State) => checklist.filter((r) => r.state === state).length;
  const summary = [
    count("missing") ? `${count("missing")} missing` : "",
    count("expired") ? `${count("expired")} expired` : "",
    count("expiring") ? `${count("expiring")} expiring soon` : "",
  ].filter(Boolean).join(" · ") || "All required documents sent";
  // Only what concerns this employee: their contract's documents and the general ones.
  const addable = [
    ...types.filter((t) => t.self_upload && t.relevant).sort((a, b) => a.position - b.position).map(({ code, label }) => ({ code, label })),
    { code: RESUME, label: "CV / résumé" },
  ];

  function pick(typeCode: string) {
    pending.current = typeCode;
    inputRef.current?.click();
  }
  function send(file: File, choice: string) {
    if (choice === RESUME) onUpload(file, null, "resume");
    else onUpload(file, choice || null, choice ? uploadCategory(typeOf.get(choice)) : "other");
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && !busy && addType) send(file, addType);
  }

  const renderRow = (row: Row) => <DocRow key={row.key} row={row} busy={busy}
    onOpen={() => row.filed && onOpen(row.filed)}
    onDownload={() => onDownload(row)}
    onPick={() => row.uploadType && pick(row.uploadType)}
    onRemove={() => row.upload && onRemove(row.upload)} />;

  return <div className="flex min-w-0 flex-col gap-6">
    {!!checklist.length && <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="font-heading text-[32px] leading-none tracking-[-0.03em] text-foreground">{filedCount} of {checklist.length} sent</span>
        <span className={MUTED}>{summary}</span>
      </div>
      <div className="flex gap-1" role="img" aria-label={`${filedCount} of ${checklist.length} required documents sent`}>
        {checklist.map((row) => <span key={row.key} className={cn("h-1.5 flex-1 rounded-full bg-border", (row.filed || row.upload) && "bg-pivot")} />)}
      </div>
    </div>}
    {!!checklist.length && <div className={ROWS}>{checklist.map(renderRow)}</div>}

    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-input bg-card p-6 text-center text-foreground" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent" aria-hidden="true"><Upload className="size-[18px]" /></span>
      <span className="text-[15px] font-medium">{busy ? "Working…" : checklist.length ? "Add another document" : "Add a document"}</span>
      <span className={MUTED}>Choose what it is, then drop the file or browse · PDF, JPG, PNG or DOCX, up to 10 MB</span>
      <span className="mt-1 flex w-full flex-wrap justify-center gap-2">
        <span className="w-[300px] max-w-full text-left">
          <TypeSearchField types={addable} value={addType} disabled={busy} onChange={setAddType} />
        </span>
        <Button disabled={busy || !addType} onClick={() => pick(addType)}>
          <Upload data-icon="inline-start" aria-hidden="true" /> Browse
        </Button>
      </span>
    </div>
    <input ref={inputRef} type="file" hidden accept={ACCEPT} aria-label="Choose a file" onChange={(e) => {
      const file = e.target.files?.[0];
      const choice = pending.current;
      pending.current = null;
      e.target.value = "";
      if (file && choice) send(file, choice);
    }} />

    {loading && !folder.length && !uploads.length && <p role="status" className={MUTED}>Loading…</p>}
    {!loading && !checklist.length && !others.length && <p className={MUTED}>Documents you upload, and those HR files for you, appear here.</p>}

    {sections.map((section) => <section key={section.title} className="flex flex-col gap-1.5">
      <h3 className="m-0 text-[13px] font-medium text-muted-foreground">{section.title}</h3>
      <div className={ROWS}>{section.rows.map(renderRow)}</div>
    </section>)}
  </div>;
}

const MUTED = "m-0 text-[13px] text-muted-foreground";
const ROWS = "flex flex-col border-t border-border";

/** Pill per row tone, as on the HR checklist (DocumentsPanel). */
const PILL: Record<State, { variant: "secondary" | "outline" | "warning" | "destructive"; className?: string }> = {
  filed: { variant: "secondary" },
  expiring: { variant: "warning" },
  expired: { variant: "destructive" },
  missing: { variant: "outline", className: "border-dashed" },
};

/** Status medallion: solid check (filed), clock ring (expiring/expired), dashed ring (missing). */
function Medallion({ state }: { state: State }) {
  return <span aria-hidden="true" className={cn(
    "inline-flex size-8 flex-none items-center justify-center rounded-full",
    state === "filed" && "bg-foreground text-background",
    state === "expiring" && "border-[1.5px] border-foreground text-foreground",
    state === "expired" && "border-[1.5px] border-destructive text-destructive",
    state === "missing" && "border-[1.5px] border-dashed border-input",
  )}>
    {state === "filed" && <Check className="size-[15px]" strokeWidth={2.2} />}
    {(state === "expiring" || state === "expired") && <Clock className="size-[15px]" strokeWidth={1.75} />}
  </span>;
}

function DocRow({ row, busy, onOpen, onDownload, onPick, onRemove }: {
  row: Row; busy: boolean; onOpen: () => void; onDownload: () => void; onPick: () => void; onRemove: () => void;
}) {
  const { filed, upload } = row;
  const file = filed ? { name: filed.file_name, size: filed.size_bytes, at: filed.created_at } : upload ? { name: upload.name, size: upload.size_bytes, at: upload.created_at } : null;
  const meta = file ? [
    formatBytes(file.size),
    `Sent ${formatDay(file.at)}`,
    filed?.expires_on && !filed.needs_review ? `Valid until ${formatDay(filed.expires_on)}` : "",
    filed && !filed.uploaded_by_me ? "Added by HR" : "",
  ].filter(Boolean).join(" · ") : "";
  const expiry = filed ? expiryState(filed, filed) : null;
  const pill = row.pill.tone === "expiring" || row.pill.tone === "expired" ? expiryLabel(expiry!) : row.pill.label;
  // Own uploads HR has not verified yet can still be taken back.
  const removable = !!upload && (!filed || filed.needs_review || filed.status !== "active");
  const tone = PILL[row.pill.tone];
  return <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-border py-4">
    <button type="button" className="group/identity flex min-w-0 flex-[1_1_240px] cursor-pointer items-center gap-3.5 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default" disabled={!file && !row.uploadType}
      onClick={filed ? onOpen : file ? onDownload : onPick} aria-label={filed ? `Open ${row.name}` : file ? `Download ${row.name}` : `Upload ${row.name}`}>
      <Medallion state={row.state} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-foreground decoration-border underline-offset-4 group-enabled/identity:group-hover/identity:underline">{row.name}</span>
        <span className="truncate text-[13px] text-muted-foreground">{row.hint}</span>
      </span>
    </button>
    <div className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
      {file ? <>
        <span className="inline-flex h-9 w-8 flex-none items-end justify-center rounded-md border border-border bg-muted pb-1.5 font-mono text-[9px] font-semibold tracking-[0.02em] text-muted-foreground" aria-hidden="true">{(file.name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm text-foreground" title={file.name}>{file.name}</span>
          <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{meta}</span>
        </span>
      </> : <span className="text-[13px] text-muted-foreground">Not sent yet</span>}
    </div>
    <div className="flex flex-none">
      <Badge variant={tone.variant} className={tone.className}>{pill}</Badge>
    </div>
    <div className="ml-auto flex flex-none items-center justify-end gap-1">
      {file ? <>
        {filed && <Button variant="ghost" size="icon-sm" title="Open" aria-label={`Open ${row.name}`} disabled={busy} onClick={onOpen}><Eye /></Button>}
        <Button variant="ghost" size="icon-sm" title="Download" aria-label={`Download ${row.name}`} disabled={busy} onClick={onDownload}><Download /></Button>
        {row.uploadType && <Button variant="ghost" size="icon-sm" title="Send a new version" aria-label={`Renew ${row.name}`} disabled={busy} onClick={onPick}><RefreshCw /></Button>}
        {removable && <Button variant="ghost" size="icon-sm" title="Remove" aria-label={`Remove ${row.name}`} disabled={busy} onClick={onRemove}><Trash2 /></Button>}
      </> : row.uploadType ? <Button size="sm" disabled={busy} onClick={onPick}>
        <Upload data-icon="inline-start" aria-hidden="true" /> Upload
      </Button> : <span className="text-[13px] text-muted-foreground">HR adds this</span>}
    </div>
  </div>;
}
