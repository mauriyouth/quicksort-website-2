import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DocumentRecord, DocumentTypeRecord } from "@quicksort/hr-db";
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
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quicksort-sas/ui";
import { formatDay, loadDocumentTypes, loadOwnerDocuments, previewDocument } from "../documents/client";
import { PageAlerts } from "../ui";
import {
  postSignatures,
  SIGNER_LABELS,
  type PreparedField,
  type RequestStatus,
  type SignatureRequest,
  type SignatureTemplate,
  type Signer,
  type SignerKind,
} from "./client";

/** Custom PDFs travel base64-encoded in a JSON body, under Vercel's ~4.5 MB request cap. */
const MAX_CUSTOM_PDF_BYTES = 3 * 1024 * 1024;
const TOO_LARGE = "This PDF is larger than 3 MB. Compress it, or send it from Youtrust directly.";

const STATUS: Record<RequestStatus, { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" }> = {
  draft: { label: "Draft", variant: "outline" },
  sending: { label: "Sending", variant: "warning" },
  sent: { label: "Sent", variant: "warning" },
  signed_by_person: { label: "Signed by person", variant: "warning" },
  completed: { label: "Signed", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};
const CANCELLABLE: RequestStatus[] = ["draft", "sending", "sent", "signed_by_person", "error"];

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The person's Youtrust signature requests (admins only) and the "Send for
 * signature" panel: choose a template or upload a PDF, fill the values the
 * record doesn't know, build the PDF preview (a draft in the person's Drive
 * folder), then send it. The signed copy is filed by the webhook or Refresh.
 * With `applicationId`, it lists only that application's requests and sends
 * new ones for it: the hiring contract that the hire step waits for.
 */
export function PersonSignatures({
  personId,
  person,
  applicationId,
}: {
  personId: string;
  /** Prefills the signer of a custom PDF. */
  person?: { name: string; email: string };
  applicationId?: string;
}) {
  const [requests, setRequests] = useState<SignatureRequest[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<SignatureRequest | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const result = await postSignatures<{ requests: SignatureRequest[] }>({ action: "list-requests", personId });
    setRequests(applicationId ? result.requests.filter((r) => r.application_id === applicationId) : result.requests);
  }, [personId, applicationId]);

  useEffect(() => {
    setRequests(null);
    reload().catch((e) => {
      setRequests([]);
      setError(errorText(e, "Could not load the signature requests."));
    });
  }, [reload]);

  async function act(row: SignatureRequest, action: "refresh" | "cancel" | "send", done: string) {
    setBusyId(row.id);
    setError("");
    setMessage("");
    try {
      await postSignatures({ action, requestId: row.id });
      await reload();
      setMessage(done);
    } catch (e) {
      setError(errorText(e, "The signature request failed."));
      // A failed action may still have changed the row (e.g. a new error message).
      await reload().catch(() => undefined);
    } finally {
      setBusyId("");
    }
  }

  async function openSigned(row: SignatureRequest) {
    if (!row.signed_document_id) return;
    setError("");
    try {
      await previewDocument({ id: row.signed_document_id, file_name: `${row.title}.pdf` });
    } catch (e) {
      setError(errorText(e, "Could not open the signed document."));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <AlertDialog open={!!confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel “{confirmCancel?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel?.youtrust_request_id && confirmCancel.status !== "error"
                ? "The request is withdrawn in Youtrust, and the signers can no longer sign it."
                : "The request is closed. Nothing has been signed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const row = confirmCancel;
                setConfirmCancel(null);
                if (row) void act(row, "cancel", "Signature request cancelled.");
              }}
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {requests === null ? (
        <p role="status" className="m-0 text-[13px] text-muted-foreground">
          Loading signature requests…
        </p>
      ) : requests.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((row) => {
              const busy = busyId === row.id;
              const signed = row.status === "completed" && !!row.signed_document_id;
              // Filed means both the signed copy and its audit trail are in the registry.
              const filed = signed && !!row.audit_document_id;
              const canRefresh = !!row.youtrust_request_id && (row.status === "sent" || row.status === "signed_by_person" || (row.status === "completed" && !filed));
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <div className="font-medium">{row.title}</div>
                    {row.error && <div className={`text-xs ${filed ? "text-muted-foreground" : "text-destructive"}`}>{row.error}</div>}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {row.status === "draft" ? "Not sent" : formatDay(row.created_at.slice(0, 10))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[row.status]?.variant ?? "secondary"}>{STATUS[row.status]?.label ?? row.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {signed && (
                        <Button variant="outline" size="xs" onClick={() => void openSigned(row)}>
                          Open signed document
                        </Button>
                      )}
                      {canRefresh && (
                        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(row, "refresh", "Status refreshed from Youtrust.")}>
                          Refresh
                        </Button>
                      )}
                      {row.status === "error" && (
                        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(row, "send", "Sent again for signature.")}>
                          Send again
                        </Button>
                      )}
                      {CANCELLABLE.includes(row.status) && (
                        <Button variant="ghost" size="xs" className="text-destructive" disabled={busy} onClick={() => setConfirmCancel(row)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="m-0 text-[13px] text-muted-foreground">No signature requests yet.</p>
      )}

      {composing ? (
        <SendPanel
          personId={personId}
          person={person}
          applicationId={applicationId}
          onClose={() => setComposing(false)}
          onSent={(email) => {
            setComposing(false);
            setMessage(email ? `Sent to ${email} for signature.` : "Sent for signature.");
            void reload().catch(() => undefined);
          }}
        />
      ) : (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError("");
              setMessage("");
              setComposing(true);
            }}
          >
            Send for signature
          </Button>
        </div>
      )}
    </div>
  );
}

type Draft = { requestId: string; previewUrl: string; pdfUrl: string };

function base64Of(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

function pdfBlobUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function SendPanel({
  personId,
  person: record,
  applicationId,
  onClose,
  onSent,
}: {
  personId: string;
  person?: { name: string; email: string };
  applicationId?: string;
  onClose: () => void;
  onSent: (email: string) => void;
}) {
  const [templates, setTemplates] = useState<SignatureTemplate[]>([]);
  const [types, setTypes] = useState<DocumentTypeRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [choice, setChoice] = useState("");
  const [fields, setFields] = useState<PreparedField[] | null>(null);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [customType, setCustomType] = useState("");
  const [customSigners, setCustomSigners] = useState<SignerKind>("person_and_quicksort");
  const [supersedes, setSupersedes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    postSignatures<{ templates: SignatureTemplate[] }>({ action: "list-templates" }).then(
      (r) => setTemplates(r.templates.filter((t) => t.active)),
      (e) => setError(errorText(e, "Could not load the templates.")),
    );
    loadDocumentTypes().then((all) => setTypes(all.filter((t) => t.owner_kinds.includes("person"))), () => setTypes([]));
    loadOwnerDocuments({ kind: "person", id: personId }).then(setDocuments, () => setDocuments([]));
  }, [personId]);

  // Object URLs for the preview are released when replaced or unmounted.
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.pdfUrl); }, [draft]);

  const custom = choice === "custom";
  const template = templates.find((t) => t.id === choice);
  const typeCode = custom ? customType : template?.type_code || "";
  const replaceable = useMemo(
    () => documents.filter((d) => d.status === "active" && d.type_code === typeCode),
    [documents, typeCode],
  );
  const person = signers.find((s) => s.role === "person");
  const quicksort = signers.find((s) => s.role === "quicksort");
  const personSigns = custom ? customSigners !== "quicksort" : !!person;

  const complete =
    !!choice &&
    (custom ? !!file && !!title.trim() && !!customType : !!fields && fields.every((f) => f.value.trim())) &&
    (!personSigns || (!!person?.name.trim() && !!person.email.trim()));

  /** Any edit after the preview means the preview no longer shows what would be sent. */
  const edited = () => { if (draft) setStale(true); };

  /** The draft stays (and can still be sent or discarded) until the server has deleted it. */
  async function discardDraft() {
    if (!draft) return;
    await postSignatures({ action: "discard-draft", requestId: draft.requestId });
    setDraft(null);
    setStale(false);
  }

  async function choose(next: string) {
    setError("");
    setBusy("choose");
    try {
      if (draft) {
        try {
          await discardDraft();
        } catch (e) {
          // Keep the current choice: its draft is still live.
          setError(errorText(e, "Could not discard the current preview."));
          return;
        }
      }
      setChoice(next);
      setFields(null);
      setSupersedes("");
      if (!next) return setSigners([]);
      if (next === "custom") {
        setSigners([{ role: "person", name: record?.name || "", email: record?.email || "", order: 0 }]);
        return;
      }
      setBusy("prepare");
      const prepared = await postSignatures<{ fields: PreparedField[]; signers: Signer[] }>({ action: "prepare", personId, templateId: next });
      setFields(prepared.fields);
      setSigners(prepared.signers);
    } catch (e) {
      setError(errorText(e, "Could not prepare the template."));
    } finally {
      setBusy("");
    }
  }

  function pickFile(next: File | null) {
    setError("");
    edited();
    if (next && next.size > MAX_CUSTOM_PDF_BYTES) {
      setFile(null);
      setError(TOO_LARGE);
      return;
    }
    setFile(next);
    if (next && !title.trim()) setTitle(next.name.replace(/\.pdf$/i, ""));
  }

  async function buildPreview() {
    setError("");
    setBusy("preview");
    try {
      if (draft) await discardDraft().catch(() => undefined);
      const signerInput = custom
        ? [
            ...(customSigners !== "quicksort" ? [{ role: "person", name: person?.name.trim() || "", email: person?.email.trim() || "" }] : []),
            ...(customSigners !== "person" ? [{ role: "quicksort", name: "", email: "" }] : []),
          ]
        : signers.map(({ role, name, email }) => ({ role, name: name.trim(), email: email.trim() }));
      const result = await postSignatures<{ request: SignatureRequest; previewUrl: string; pdfBase64?: string | null }>({
        action: "preview",
        personId,
        ...(applicationId ? { applicationId } : {}),
        signers: signerInput,
        supersedes: supersedes || null,
        ...(custom
          ? { title: title.trim(), typeCode: customType, pdfBase64: await base64Of(file!) }
          : { templateId: choice, values: Object.fromEntries((fields ?? []).map((f) => [f.name, f.value.trim()])) }),
      });
      const pdfUrl = result.pdfBase64 ? pdfBlobUrl(result.pdfBase64) : URL.createObjectURL(file ?? new Blob([], { type: "application/pdf" }));
      setDraft({ requestId: result.request.id, previewUrl: result.previewUrl, pdfUrl });
      setStale(false);
    } catch (e) {
      setError(errorText(e, "Could not build the preview."));
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!draft) return;
    setError("");
    setBusy("send");
    try {
      await postSignatures({ action: "send", requestId: draft.requestId });
      onSent(person?.email || "");
    } catch (e) {
      setError(errorText(e, "Could not send the request."));
      setBusy("");
    }
  }

  async function discard() {
    setError("");
    setBusy("discard");
    try {
      await discardDraft();
      onClose();
    } catch (e) {
      setError(errorText(e, "Could not discard the draft."));
      setBusy("");
    }
  }

  const setField = (name: string, value: string) => {
    edited();
    setFields((current) => current && current.map((f) => (f.name === name ? { ...f, value } : f)));
  };
  const setPerson = (patch: Partial<Signer>) => {
    edited();
    setSigners((current) => current.map((s) => (s.role === "person" ? { ...s, ...patch } : s)));
  };

  return (
    <section aria-label="Send for signature" className="flex flex-col gap-5 rounded-lg border border-border p-4">
      <PageAlerts error={error} />
      <Step n={1} title="Document">
        <Field>
          <FieldLabel htmlFor="signature-template">Template</FieldLabel>
          <NativeSelect id="signature-template" value={choice} disabled={!!busy} onChange={(e) => void choose(e.target.value)}>
            <NativeSelectOption value="">Choose a template</NativeSelectOption>
            {templates.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="custom">Custom PDF</NativeSelectOption>
          </NativeSelect>
        </Field>
        {custom && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="signature-pdf">PDF file</FieldLabel>
              <Input id="signature-pdf" type="file" accept="application/pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              <FieldDescription>Up to 3 MB.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="signature-title">Title</FieldLabel>
              <Input id="signature-title" value={title} onChange={(e) => { edited(); setTitle(e.target.value); }} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="signature-type">Document type</FieldLabel>
              <NativeSelect id="signature-type" value={customType} onChange={(e) => { edited(); setCustomType(e.target.value); setSupersedes(""); }}>
                <NativeSelectOption value="">Choose a type</NativeSelectOption>
                {types.map((t) => (
                  <NativeSelectOption key={t.code} value={t.code}>
                    {t.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="signature-signers">Signers</FieldLabel>
              <NativeSelect id="signature-signers" value={customSigners} onChange={(e) => { edited(); setCustomSigners(e.target.value as SignerKind); }}>
                {(Object.keys(SIGNER_LABELS) as SignerKind[]).map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {SIGNER_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
        )}
      </Step>

      {busy === "prepare" && (
        <p role="status" className="m-0 text-[13px] text-muted-foreground">
          Reading the template…
        </p>
      )}

      {choice && busy !== "prepare" && (custom || !!fields) && (
        <Step n={2} title="Values">
          {!!fields?.length && (
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.name}>
                  <FieldLabel htmlFor={`signature-field-${f.name}`} className="font-mono text-xs">
                    {f.name}
                  </FieldLabel>
                  <Input
                    id={`signature-field-${f.name}`}
                    value={f.value}
                    required={!f.known}
                    aria-invalid={!f.value.trim() || undefined}
                    onChange={(e) => setField(f.name, e.target.value)}
                  />
                  {!f.known && <FieldDescription>Not on the record. Fill it in.</FieldDescription>}
                </Field>
              ))}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {personSigns && (
              <>
                <Field>
                  <FieldLabel htmlFor="signature-signer-name">Signer name</FieldLabel>
                  <Input id="signature-signer-name" value={person?.name || ""} onChange={(e) => setPerson({ name: e.target.value })} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="signature-signer-email">Signer email</FieldLabel>
                  <Input id="signature-signer-email" type="email" value={person?.email || ""} onChange={(e) => setPerson({ email: e.target.value })} required />
                </Field>
              </>
            )}
            <Field className={personSigns ? "md:col-span-2" : undefined}>
              <FieldLabel htmlFor="signature-replaces">Replaces</FieldLabel>
              <NativeSelect id="signature-replaces" value={supersedes} onChange={(e) => { edited(); setSupersedes(e.target.value); }}>
                <NativeSelectOption value="">Nothing</NativeSelectOption>
                {replaceable.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.title || d.file_name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>Once signed, the new copy supersedes this document.</FieldDescription>
            </Field>
          </div>
          {(quicksort || (custom && customSigners !== "person")) && (
            <p className="m-0 text-[13px] text-muted-foreground">
              {quicksort ? `Then ${quicksort.name || "the Quicksort signatory"} signs for Quicksort.` : "Then the Quicksort signatory signs."}
            </p>
          )}
        </Step>
      )}

      {choice && (
        <Step n={3} title="Preview">
          <div>
            <Button variant="outline" disabled={!complete || !!busy} onClick={() => void buildPreview()}>
              {busy === "preview" ? "Building…" : draft ? "Build preview again" : "Build preview"}
            </Button>
          </div>
          {draft && (
            <div className="flex flex-col gap-2">
              <object type="application/pdf" data={draft.pdfUrl} aria-label="Preview of the PDF to sign" className="h-[32rem] w-full rounded-md border border-border">
                <p className="m-0 p-4 text-[13px] text-muted-foreground">This browser can't show the PDF here. Open it in Drive.</p>
              </object>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <a href={draft.previewUrl} target="_blank" rel="noreferrer" className="underline">
                  Open in Drive
                </a>
                {stale && <span className="text-muted-foreground">Values changed. Build the preview again before sending.</span>}
              </div>
            </div>
          )}
        </Step>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" disabled={!!busy} onClick={() => void discard()}>
          {busy === "discard" ? "Discarding…" : "Discard"}
        </Button>
        <Button variant="pivot" disabled={!complete || !draft || stale || !!busy} onClick={() => void send()}>
          {busy === "send" ? "Sending…" : "Send for signature"}
        </Button>
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">
        <span className="text-muted-foreground">{n}.</span> {title}
      </div>
      {children}
    </div>
  );
}
