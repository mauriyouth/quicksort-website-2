import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NotConfiguredError } from "../server/bank/run.ts";
import { personFolder } from "../server/documents/file.ts";
import { defaultStorage } from "../server/documents/handler.ts";
import { loadDriveSettings } from "../server/documents/storage/google-drive.ts";
import { browserOrigin } from "../server/documents/storage/origin.ts";
import type { DocumentStorage } from "../server/documents/storage/types.ts";
import { completeRequest } from "../server/signatures/complete.ts";
import { extractFields, knownValues, loadPersonFacts, missingFields } from "../server/signatures/fields.ts";
import { DocAccessError, fillTemplate, listFolderDocs, readDocText } from "../server/signatures/google-docs.ts";
import { encryptSignatureCredentials, loadSignatureSettings, youtrustFromSettings } from "../server/signatures/settings.ts";
import { canMoveTo, statusFromYoutrust } from "../server/signatures/webhook.ts";
import type { RequestStatus } from "../server/signatures/webhook.ts";
import { YoutrustError } from "../server/signatures/youtrust.ts";
import type { YoutrustClient } from "../server/signatures/youtrust.ts";

/**
 * Youtrust contract signing, admins only. POST { action }:
 *   get-settings | save-settings            Youtrust options and write-only credentials.
 *   list-templates | save-template          Google Doc templates (checked readable by the service account).
 *   list-template-docs                      The Docs in the Drive templates folder, when one is set.
 *   list-requests { personId }              The person's requests, newest first.
 *   prepare { personId, templateId, applicationId? }
 *                                           The template's fields, prefilled from data (the
 *                                           application's accepted offer when given), and the signers.
 *   preview { personId, templateId, values, signers, supersedes?, applicationId? }
 *         | { personId, title, typeCode, pdfBase64, signers, supersedes?, applicationId? }
 *                                           Builds the PDF in the person's folder and stores a draft.
 *   send | refresh | cancel | discard-draft { requestId }
 * signature_settings has no client grants, so it is read and written with the
 * service-role client, as is completion filing (register_signed_document).
 * Both are only created after the admin check.
 */
export const config = { maxDuration: 60 };

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type ServiceAccount = { client_email: string; private_key: string; templates_root_folder_id?: string; templates_root_folder_name?: string };
type Deps = {
  createClient: typeof createClient;
  createYoutrust: typeof youtrustFromSettings;
  docs: { readDocText: typeof readDocText; fillTemplate: typeof fillTemplate; listFolderDocs: typeof listFolderDocs };
  storage: (client: SupabaseClient) => Promise<DocumentStorage | null>;
  loadServiceAccount?: (client: SupabaseClient) => Promise<ServiceAccount | null>;
  now?: () => Date;
};
type Result = { status: number; body: unknown };
type SignerKind = "person_and_quicksort" | "person" | "quicksort";
type Signer = { role: "person" | "quicksort"; name: string; email: string; order: number };
type Template = { id: string; name: string; google_doc_id: string; signers: SignerKind; type_code: string; active: boolean };
type RequestRow = {
  id: string; person_id: string; template_id: string | null; title: string; type_code: string; signers: Signer[];
  supersedes: string | null; application_id: string | null; status: RequestStatus; error: string; youtrust_request_id: string | null;
  doc_copy_file_id: string | null; pdf_file_id: string | null; pdf_folder_id: string | null;
  signed_document_id: string | null; audit_document_id: string | null; updated_at: string;
};

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** A "sending" row this old was interrupted (functions time out at 60 s). */
const STALE_SENDING_MS = 2 * 60 * 1000;
/** Inline previews stay well under the ~4.5 MB serverless response cap once base64-encoded. */
const INLINE_PREVIEW_BYTES = 3 * 1024 * 1024;
const uuid = z.uuid();
const signerKind = z.enum(["person_and_quicksort", "person", "quicksort"]);
const typeCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
const signerInput = z.array(z.object({
  role: z.enum(["person", "quicksort"]),
  name: z.string().trim().max(200).default(""),
  email: z.string().trim().max(320).default(""),
})).min(1).max(2);
const requestRef = { requestId: uuid };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get-settings") }),
  z.object({
    action: z.literal("save-settings"),
    staging: z.boolean(),
    signatoryName: z.string().trim().max(200),
    signatoryEmail: z.union([z.literal(""), z.email().max(320)]),
    apiKey: z.string().trim().min(1).max(1000).optional(),
    webhookSecret: z.string().trim().min(1).max(1000).optional(),
  }),
  z.object({ action: z.literal("list-templates") }),
  z.object({ action: z.literal("list-template-docs") }),
  z.object({
    action: z.literal("save-template"),
    id: uuid.optional(),
    name: z.string().trim().min(1).max(200),
    googleDocUrl: z.string().trim().min(1).max(2000),
    signers: signerKind,
    typeCode,
    active: z.boolean(),
  }),
  z.object({ action: z.literal("list-requests"), personId: uuid }),
  z.object({ action: z.literal("prepare"), personId: uuid, templateId: uuid, applicationId: uuid.optional() }),
  z.object({
    action: z.literal("preview"),
    personId: uuid,
    signers: signerInput,
    supersedes: uuid.nullish(),
    applicationId: uuid.optional(),
    templateId: uuid.optional(),
    values: z.record(z.string(), z.string().max(5000)).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    typeCode: typeCode.optional(),
    pdfBase64: z.string().max(Math.ceil((MAX_PDF_BYTES * 4) / 3) + 8).optional(),
  }),
  z.object({ action: z.literal("send"), ...requestRef }),
  z.object({ action: z.literal("refresh"), ...requestRef }),
  z.object({ action: z.literal("cancel"), ...requestRef }),
  z.object({ action: z.literal("discard-draft"), ...requestRef }),
]);
type Action = z.infer<typeof actionSchema>;
type Input<A extends Action["action"]> = Extract<Action, { action: A }>;

/** The Doc ID from a Google Docs link, or a bare ID. */
export function docIdFrom(value: string): string | null {
  const match = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,})/.exec(value);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(value) ? value : null;
}

/** Person first (order 0), then Quicksort's signatory (order 1). */
export function buildSigners(
  kind: SignerKind,
  person: { name: string; email: string },
  signatory: { signatoryName: string; signatoryEmail: string },
): Signer[] {
  const signers: Signer[] = [];
  if (kind !== "quicksort") signers.push({ role: "person", name: person.name, email: person.email, order: 0 });
  if (kind !== "person") signers.push({ role: "quicksort", name: signatory.signatoryName, email: signatory.signatoryEmail, order: 1 });
  return signers;
}

const validEmail = (email: string) => z.email().safeParse(email).success;

function check(error: { message?: string; code?: string } | null, fallback: string) {
  if (error) throw Object.assign(new Error(fallback), { code: error.code || "db" });
}

export function createSignaturesHandler(deps: Deps = {
  createClient, createYoutrust: youtrustFromSettings, docs: { readDocText, fillTemplate, listFolderDocs }, storage: defaultStorage,
}) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage signatures." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "The signatures module needs its portal connection configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });
      const userId = String(identity.data);

      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid signatures request." });

      // Created only past the admin check above.
      let serviceClient: SupabaseClient | null = null;
      const service = () => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) throw new HttpError("Signatures need SUPABASE_SERVICE_ROLE_KEY configured on the server.", 503);
        return (serviceClient ??= deps.createClient(url, serviceKey));
      };
      let settingsPromise: ReturnType<typeof loadSignatureSettings> | null = null;
      const settings = () => (settingsPromise ??= loadSignatureSettings(service()));
      const youtrust = async (): Promise<YoutrustClient> => deps.createYoutrust(await settings());
      const storage = async () => {
        const found = await deps.storage(client);
        if (!found) throw new HttpError("Connect Google Drive in Settings first.", 409);
        return found;
      };
      const serviceAccount = async (): Promise<ServiceAccount> => {
        const sa = await (deps.loadServiceAccount ?? loadDriveSettings)(client);
        if (!sa) throw new HttpError("Connect Google Drive in Settings first.", 409);
        return sa;
      };
      const today = () => (deps.now?.() ?? new Date()).toISOString().slice(0, 10);

      async function loadPerson(personId: string) {
        const { data, error } = await client.from("hr_people").select("id,full_name,email").eq("id", personId).maybeSingle();
        check(error, "Could not read the person.");
        if (!data) throw new HttpError("Person not found.", 404);
        return data as { id: string; full_name: string; email: string | null };
      }
      async function checkApplication(applicationId: string, personId: string) {
        const { data, error } = await client.from("hr_applications").select("id,person_id").eq("id", applicationId).maybeSingle();
        check(error, "Could not read the application.");
        if (!data || data.person_id !== personId) throw new HttpError("Application does not belong to this person.", 400);
      }
      async function loadTemplate(id: string) {
        const { data, error } = await client.from("signature_templates").select("*").eq("id", id).maybeSingle();
        check(error, "Could not read the template.");
        if (!data) throw new HttpError("Template not found.", 404);
        const template = data as Template;
        if (!template.active) throw new HttpError("This template is inactive.", 400);
        return template;
      }
      async function loadRequest(id: string) {
        const { data, error } = await client.from("signature_requests").select("*").eq("id", id).maybeSingle();
        check(error, "Could not read the signature request.");
        if (!data) throw new HttpError("Signature request not found.", 404);
        return data as RequestRow;
      }
      /** Status writes are conditional on the status the move was decided from. */
      async function moveStatus(row: RequestRow, from: RequestStatus[], values: Record<string, unknown>) {
        const { data, error } = await client.from("signature_requests").update(values).eq("id", row.id).in("status", from).select();
        check(error, "Could not update the signature request.");
        return (data ?? []) as RequestRow[];
      }
      const visible = (s: Awaited<ReturnType<typeof loadSignatureSettings>>) => {
        const { apiKey: _k, webhookSecret: _w, ...rest } = s;
        return rest;
      };

      const actions: { [A in Action["action"]]: (input: Input<A>) => Promise<Result> } = {
        async "get-settings"() {
          const sa = await (deps.loadServiceAccount ?? loadDriveSettings)(client);
          const origin = browserOrigin(req);
          return { status: 200, body: {
            ...visible(await settings()),
            serviceAccountEmail: sa?.client_email ?? "",
            webhookUrl: origin ? `${origin}/api/youtrust-webhook` : "",
          } };
        },

        async "save-settings"(input) {
          const current = await settings();
          const row: Record<string, unknown> = {
            id: "default",
            options: { staging: input.staging, signatory_name: input.signatoryName, signatory_email: input.signatoryEmail },
          };
          if (input.apiKey || input.webhookSecret) {
            row.encrypted_credentials = encryptSignatureCredentials({
              apiKey: input.apiKey ?? current.apiKey, webhookSecret: input.webhookSecret ?? current.webhookSecret,
            });
          }
          const { error } = await service().from("signature_settings").upsert(row, { onConflict: "id" });
          check(error, "Could not save the signature settings.");
          settingsPromise = null;
          return { status: 200, body: visible(await settings()) };
        },

        async "list-templates"() {
          const { data, error } = await client.from("signature_templates").select("*").order("name");
          check(error, "Could not read the templates.");
          return { status: 200, body: { templates: data ?? [] } };
        },

        async "list-template-docs"() {
          const sa = await serviceAccount();
          const folderId = sa.templates_root_folder_id;
          if (!folderId) return { status: 200, body: { folder: null, docs: [] } };
          const docs = await deps.docs.listFolderDocs(sa, folderId).catch((error: { status?: number }) => {
            if (error?.status === 403 || error?.status === 404)
              throw new HttpError(`Share the templates folder with ${sa.client_email}.`, 409);
            throw error;
          });
          return { status: 200, body: { folder: { id: folderId, name: sa.templates_root_folder_name || "" }, docs } };
        },

        async "save-template"(input) {
          const docId = docIdFrom(input.googleDocUrl);
          if (!docId) throw new HttpError("Paste the Google Docs link of the template.", 400);
          const type = await client.from("document_types").select("code,owner_kinds").eq("code", input.typeCode).maybeSingle();
          check(type.error, "Could not read the document type.");
          if (!type.data || !(type.data.owner_kinds as string[]).includes("person")) throw new HttpError("Choose a document type for people.", 400);
          const fields = extractFields(await deps.docs.readDocText(await serviceAccount(), docId));
          const values = { name: input.name, google_doc_id: docId, signers: input.signers, type_code: input.typeCode, active: input.active };
          const saved = input.id
            ? await client.from("signature_templates").update(values).eq("id", input.id).select().maybeSingle()
            : await client.from("signature_templates").insert({ ...values, created_by: userId }).select().single();
          if (saved.error?.code === "23505") throw new HttpError("A template with this name already exists.", 409);
          check(saved.error, "Could not save the template.");
          if (!saved.data) throw new HttpError("Template not found.", 404);
          return { status: 200, body: { template: saved.data, fields } };
        },

        async "list-requests"(input) {
          const { data, error } = await client.from("signature_requests").select("*").eq("person_id", input.personId).order("created_at", { ascending: false });
          check(error, "Could not read the signature requests.");
          return { status: 200, body: { requests: data ?? [] } };
        },

        async prepare(input) {
          await loadPerson(input.personId);
          if (input.applicationId) await checkApplication(input.applicationId, input.personId);
          const template = await loadTemplate(input.templateId);
          const [facts, s, sa] = await Promise.all([
            loadPersonFacts(client, input.personId, input.applicationId), settings(), serviceAccount(),
          ]);
          const names = extractFields(await deps.docs.readDocText(sa, template.google_doc_id));
          const known = knownValues(facts, today(), s.signatoryName);
          const fields = names.map((name) => {
            const value = known[name] ?? "";
            return { name, value, known: Boolean(value) };
          });
          return { status: 200, body: { fields, signers: buildSigners(template.signers, { name: facts.fullName, email: facts.email }, s) } };
        },

        async preview(input) {
          const person = await loadPerson(input.personId);
          const template = input.templateId ? await loadTemplate(input.templateId) : null;
          if (!template && (!input.title || !input.typeCode || !input.pdfBase64)) {
            throw new HttpError("Choose a template, or upload a PDF with a title and document type.", 400);
          }
          const typeCode = template ? template.type_code : input.typeCode!;
          const title = template ? template.name : input.title!;

          let pdf: Uint8Array | null = null;
          if (!template) {
            pdf = new Uint8Array(Buffer.from(input.pdfBase64!, "base64"));
            if (pdf.byteLength > MAX_PDF_BYTES) throw new HttpError("The PDF is larger than 10 MB.", 400);
            if (Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new HttpError("Upload a PDF file.", 400);
          }

          const s = await settings();
          const given = input.signers.find((x) => x.role === "person");
          const roles = new Set(input.signers.map((x) => x.role));
          const kind: SignerKind = template ? template.signers
            : roles.has("person") && roles.has("quicksort") ? "person_and_quicksort" : roles.has("person") ? "person" : "quicksort";
          const signers = buildSigners(kind, { name: given?.name || person.full_name, email: given?.email || person.email || "" }, s);
          for (const signer of signers) {
            const ready = signer.name.trim() && validEmail(signer.email);
            if (!ready && signer.role === "quicksort") throw new HttpError("Set the Quicksort signatory in Settings → Signatures first.", 409);
            if (!ready) throw new HttpError("Add the signer's name and a valid email.", 400);
          }

          if (input.supersedes) {
            const { data, error } = await client.from("documents").select("id")
              .eq("id", input.supersedes).eq("person_id", person.id).eq("type_code", typeCode).eq("status", "active").maybeSingle();
            check(error, "Could not read the document to replace.");
            if (!data) throw new HttpError("Choose an active document of the same type to replace.", 400);
          }

          if (input.applicationId) await checkApplication(input.applicationId, person.id);

          // Refuse missing values before any folder or file is created.
          let fieldValues: Record<string, string> = {};
          const sa = template ? await serviceAccount() : null;
          if (template) {
            const fields = extractFields(await deps.docs.readDocText(sa!, template.google_doc_id));
            const values = input.values ?? {};
            const missing = missingFields(fields, values);
            if (missing.length) throw new HttpError(`Fill in: ${missing.join(", ")}`, 400);
            fieldValues = Object.fromEntries(fields.map((field) => [field, values[field].trim()]));
          }

          let docCopyId: string | null = null;
          const st = await storage();
          const folder = await personFolder(client, st, person.id, typeCode);
          const name = `${title} – ${person.full_name}`;
          if (template) {
            const filled = await deps.docs.fillTemplate(sa!, { templateDocId: template.google_doc_id, folderId: folder.id, name, values: fieldValues });
            docCopyId = filled.docCopyId;
            pdf = filled.pdf;
          }

          const trashAll = async (ids: (string | null)[]) => {
            for (const id of ids) if (id) await st.trash(id).catch(() => undefined);
          };
          let file;
          try {
            file = await st.uploadFile(folder, { name: `${name}.pdf`, mimeType: "application/pdf" }, pdf!);
          } catch (error) {
            await trashAll([docCopyId]);
            throw error;
          }
          const inserted = await client.from("signature_requests").insert({
            person_id: person.id, template_id: template?.id ?? null, title, type_code: typeCode, signers, field_values: fieldValues,
            supersedes: input.supersedes ?? null, application_id: input.applicationId ?? null, status: "draft", doc_copy_file_id: docCopyId, pdf_file_id: file.id,
            pdf_folder_id: folder.id, created_by: userId,
          }).select().single();
          if (inserted.error || !inserted.data) {
            await trashAll([docCopyId, file.id]);
            check(inserted.error, "Could not save the draft.");
          }
          return { status: 200, body: {
            request: inserted.data,
            previewUrl: file.link,
            pdfBase64: template && pdf!.byteLength <= INLINE_PREVIEW_BYTES ? Buffer.from(pdf!).toString("base64") : null,
          } };
        },

        async send(input) {
          const row = await loadRequest(input.requestId);
          if (row.status !== "draft" && row.status !== "error") throw new HttpError("Already sent.", 409);
          const [yt, st] = await Promise.all([youtrust(), storage()]);
          if (!row.pdf_file_id) throw new HttpError("This draft has no PDF. Discard it and build the preview again.", 409);
          const claimed = await moveStatus(row, ["draft", "error"], { status: "sending", error: "" });
          if (!claimed.length) throw new HttpError("Already sent.", 409);

          let created: { requestId: string; documentId: string };
          try {
            const pdf = new Uint8Array(await (await st.download(row.pdf_file_id)).arrayBuffer());
            created = await yt.createRequest({
              name: row.title,
              signers: row.signers.map(({ name, email, order }) => ({ name, email, order })),
              pdf, fileName: `${row.title}.pdf`, externalId: row.id,
            });
          } catch (error) {
            const message = (error as Error)?.message || "Sending to Youtrust failed.";
            await moveStatus(row, ["sending"], { status: "error", error: message.slice(0, 1000) });
            return { status: 502, body: { error: message } };
          }
          try {
            const sent = await moveStatus(row, ["sending"], {
              status: "sent", youtrust_request_id: created.requestId, youtrust_document_id: created.documentId,
            });
            if (!sent.length) throw new Error("The request left the sending status.");
            return { status: 200, body: { request: sent[0] } };
          } catch (error) {
            // Youtrust has a live request we could not record: keep its ids where HR and the logs can find them.
            const ids = `Youtrust request ${created.requestId}, document ${created.documentId}`;
            console.error(`signatures: sent ${row.id} to Youtrust but could not store the ids (${ids})`, error);
            const message = `Sent to Youtrust (${ids}) but the ids could not be saved. Check Youtrust before sending again.`;
            await moveStatus(row, ["sending"], { status: "error", error: message }).catch(() => undefined);
            return { status: 502, body: { error: message } };
          }
        },

        async refresh(input) {
          const row = await loadRequest(input.requestId);
          if (!row.youtrust_request_id) throw new HttpError("This request has not been sent yet.", 409);
          const yt = await youtrust();
          const remote = await yt.getStatus(row.youtrust_request_id);
          const personEmail = row.signers.find((x) => x.role === "person")?.email ?? "";
          const next = statusFromYoutrust(remote.status, remote.signers, personEmail, row.status);
          const filed = Boolean(row.signed_document_id && row.audit_document_id);
          if (next === "completed" && (canMoveTo(row.status, "completed") || (row.status === "completed" && !filed))) {
            await completeRequest(service(), yt, await storage(), row, deps.now?.() ?? new Date());
          } else if (canMoveTo(row.status, next)) {
            await moveStatus(row, [row.status], { status: next });
          }
          return { status: 200, body: { request: await loadRequest(row.id) } };
        },

        async cancel(input) {
          const row = await loadRequest(input.requestId);
          if (row.status === "draft" || row.status === "error") {
            await moveStatus(row, [row.status], { status: "cancelled" });
          } else if ((row.status === "sent" || row.status === "signed_by_person") && row.youtrust_request_id) {
            await (await youtrust()).cancel(row.youtrust_request_id, "Cancelled from the Quicksort admin.");
            await moveStatus(row, ["sent", "signed_by_person"], { status: "cancelled" });
          } else if (row.status === "sending") {
            // A send that died mid-way (function timeout) would otherwise stay "sending" forever.
            const age = (deps.now?.() ?? new Date()).getTime() - new Date(row.updated_at).getTime();
            if (!(age > STALE_SENDING_MS)) throw new HttpError("This request is being sent. Try again in a moment.", 409);
            await moveStatus(row, ["sending"], { status: "error", error: "The send was interrupted. Check Youtrust before sending again." });
          } else {
            throw new HttpError("This request is already closed.", 409);
          }
          return { status: 200, body: { request: await loadRequest(row.id) } };
        },

        async "discard-draft"(input) {
          const row = await loadRequest(input.requestId);
          if (row.status !== "draft" && row.status !== "error") throw new HttpError("Only a draft can be discarded.", 409);
          const st = await storage();
          // Delete first, conditionally: a draft being sent meanwhile keeps its files.
          const { data, error } = await client.from("signature_requests").delete().eq("id", row.id).in("status", ["draft", "error"]).select();
          check(error, "Could not delete the draft.");
          if (!data?.length) throw new HttpError("Only a draft can be discarded.", 409);
          // The row is gone: a file left behind is untidy, not a failure.
          for (const id of [row.doc_copy_file_id, row.pdf_file_id]) if (id) await st.trash(id).catch(() => undefined);
          return { status: 200, body: { deleted: true } };
        },
      };

      const run = actions[parsed.data.action] as (input: Action) => Promise<Result>;
      const result = await run(parsed.data);
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
      if (error instanceof DocAccessError) return res.status(400).json({ error: error.message });
      if (error instanceof NotConfiguredError) return res.status(409).json({ error: error.message });
      if (error instanceof YoutrustError) return res.status(502).json({ error: error.message });
      // Errors with a message but no database code are user-safe (Drive sharing,
      // unknown document type); database errors stay generic.
      const err = error as { message?: string; code?: string; status?: number } | null;
      // Refusals raised by the database (e.g. register_signed_document) carry a user-safe message.
      if (err?.code === "P0001" && err.message) return res.status(400).json({ error: err.message });
      if (err?.message && !err.code) {
        const status = err.status === 400 || err.status === 404 || err.status === 409 ? err.status : 502;
        return res.status(status).json({ error: err.message });
      }
      return res.status(502).json({ error: "The signatures request failed. Please try again." });
    }
  };
}

export default createSignaturesHandler();
