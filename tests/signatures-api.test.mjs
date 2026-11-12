import { test } from "node:test";
import assert from "node:assert/strict";
import { createSignaturesHandler } from "../apps/admin/api/signatures.ts";
import { encryptSignatureCredentials, loadSignatureSettings } from "../apps/admin/server/signatures/settings.ts";
import { completeRequest, SUPERSEDES_CHANGED_NOTE } from "../apps/admin/server/signatures/complete.ts";
import { DocAccessError } from "../apps/admin/server/signatures/google-docs.ts";
import { YoutrustError } from "../apps/admin/server/signatures/youtrust.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);

const API_KEY = "youtrust-api-key-secret";
const WEBHOOK_SECRET = "youtrust-webhook-secret";
const PERSON = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const QS_TEMPLATE = "55555555-5555-4555-8555-555555555555";
const SA = { client_email: "sa@proj.iam.gserviceaccount.com", private_key: "unused" };
const PDF = new Uint8Array([...Buffer.from("%PDF-1.7 synthetic contract")]);
const DOC_TEXT = "Contrat de {{prenom}} {{nom}}. Salaire : {{salaire_brut_mensuel}}. {{clause_speciale}}";

// In-memory Supabase (copied from tests/invoicing-api.test.mjs): tables are arrays,
// filters are applied, writes are logged in `ops`. Ids are UUIDs; rpc also files register_signed_document.
function memoryClient(tables, ops, { failures = {} } = {}) {
  let seq = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const copy = (r) => ({ ...r });
  return {
    async rpc(name, args) {
      if (name === "sync_clerk_profile") return { data: "user-1", error: null };
      if (name === "register_signed_document") {
        ops.push({ op: "rpc", table: name, value: args });
        const failure = typeof failures === "function" ? failures(name, "rpc", args) : failures[`${name}.rpc`];
        if (failure) return { data: null, error: failure };
        const row = { id: nextId(), status: "active", ...args.document };
        (tables.documents ??= []).push(row);
        return { data: copy(row), error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
    from(table) {
      const filters = [];
      let mode = "select", payload, options, returning = false, single = null, orderBy = null;
      const cmp = (fn) => (c, v) => { filters.push((r) => fn(r[c], v)); return q; };
      const q = {
        select() { if (mode !== "select") returning = true; return q; },
        eq: cmp((a, b) => a === b), neq: cmp((a, b) => a !== b), in: cmp((a, b) => b.includes(a)),
        gte: cmp((a, b) => a != null && a >= b), lte: cmp((a, b) => a != null && a <= b),
        is: cmp((a, b) => (a ?? null) === b),
        // PostgREST logic tree, e.g. `col.is.null,col.lt."2026-…"`.
        or(expr) {
          const parts = expr.split(",").map((part) => {
            const [c, op, ...rest] = part.split(".");
            const raw = rest.join(".").replace(/^"|"$/g, "");
            const v = raw === "null" ? null : raw;
            return (r) => op === "is" ? (r[c] ?? null) === v : op === "lt" ? r[c] != null && r[c] < v : op === "eq" ? r[c] === v : false;
          });
          filters.push((r) => parts.some((f) => f(r)));
          return q;
        },
        order(c, o = {}) { orderBy = { c, asc: o.ascending !== false }; return q; },
        limit() { return q; },
        insert(v) { mode = "insert"; payload = v; return q; },
        update(v) { mode = "update"; payload = v; return q; },
        upsert(v, o) { mode = "upsert"; payload = v; options = o; return q; },
        delete() { mode = "delete"; return q; },
        single() { single = "one"; return q; },
        maybeSingle() { single = "maybe"; return q; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      function shape(list) {
        if (!single) return { data: list, error: null };
        if (list.length === 1) return { data: list[0], error: null };
        if (single === "maybe" && list.length === 0) return { data: null, error: null };
        return { data: null, error: { message: "single row expected", code: "PGRST116" } };
      }
      function run() {
        const rows = (tables[table] ??= []);
        const match = (r) => filters.every((f) => f(r));
        if (mode !== "select") ops.push({ op: mode, table, value: payload, options });
        const failure = typeof failures === "function" ? failures(table, mode, payload) : failures[`${table}.${mode}`];
        if (failure) return { data: null, error: failure };
        if (mode === "select") {
          const list = rows.filter(match).map(copy);
          if (orderBy) list.sort((a, b) => ((a[orderBy.c] ?? "") < (b[orderBy.c] ?? "") ? -1 : (a[orderBy.c] ?? "") > (b[orderBy.c] ?? "") ? 1 : 0) * (orderBy.asc ? 1 : -1));
          return shape(list);
        }
        if (mode === "insert") {
          const added = [];
          for (const v of Array.isArray(payload) ? payload : [payload]) {
            const row = { id: nextId(), created_at: new Date(Date.UTC(2026, 10, 9, 0, 0, seq)).toISOString(), ...v };
            rows.push(row);
            added.push(copy(row));
          }
          return returning ? shape(added) : { data: null, error: null };
        }
        if (mode === "update") {
          const changed = rows.filter(match);
          for (const r of changed) Object.assign(r, payload);
          return returning ? shape(changed.map(copy)) : { data: null, error: null };
        }
        if (mode === "upsert") {
          const keys = (options?.onConflict ?? "id").split(",");
          for (const v of Array.isArray(payload) ? payload : [payload]) {
            const found = rows.find((r) => keys.every((k) => r[k] === v[k]));
            if (found) { if (!options?.ignoreDuplicates) Object.assign(found, v); }
            else rows.push({ id: nextId(), ...v });
          }
          return { data: null, error: null };
        }
        const gone = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
        return returning ? shape(gone.map(copy)) : { data: null, error: null };
      }
      return q;
    },
  };
}

function fixture({ admin = true, youtrust: overrides = {}, readDocText, failures } = {}) {
  const tables = {
    user_roles: [{ user_id: "user-1", role: admin ? "admin" : "hr" }],
    hr_people: [{ id: PERSON, full_name: "Ada Lovelace", email: "ada@example.test" }],
    employees: [{ id: EMP, person_id: PERSON, role: "Data Engineer", start_date: "2026-01-05", status: "active", probation_end: null, offer_id: null, matricule: "M001" }],
    employee_salaries: [{ employee_id: EMP, rate_kind: "monthly", salary_monthly: 3500, daily_rate: null, start_date: "2026-01-01", end_date: null }],
    document_types: [
      { code: "EMPLOYMENT_CONTRACT", label: "Contrat de travail", owner_kinds: ["person"], folder: "contrat_travail", requires_expiry: false },
      { code: "OTHER", label: "Autre", owner_kinds: ["person", "client", "project"], folder: "divers", requires_expiry: false },
    ],
    document_folders: [],
    documents: [],
    signature_settings: [{
      id: "default",
      options: { staging: true, signatory_name: "Mohamed Nah", signatory_email: "mohamed@quicksort.test" },
      encrypted_credentials: encryptSignatureCredentials({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET }),
    }],
    signature_templates: [
      { id: TEMPLATE, name: "CDI standard", google_doc_id: "doc-cdi", signers: "person_and_quicksort", type_code: "EMPLOYMENT_CONTRACT", active: true },
      { id: QS_TEMPLATE, name: "Attestation", google_doc_id: "doc-att", signers: "quicksort", type_code: "OTHER", active: true },
    ],
    signature_requests: [],
  };
  const ops = [];
  const calls = [];
  const log = (name, fn) => async (...args) => { calls.push({ name, args }); return fn(...args); };
  const client = memoryClient(tables, ops, { failures });
  const youtrust = {
    createRequest: log("createRequest", overrides.createRequest ?? (async () => ({ requestId: "yt-1", documentId: "ytd-1" }))),
    getStatus: log("getStatus", overrides.getStatus ?? (async () => ({ status: "ongoing", signers: [] }))),
    cancel: log("cancel", overrides.cancel ?? (async () => {})),
    downloadSigned: log("downloadSigned", overrides.downloadSigned ?? (async () => PDF)),
    downloadAuditTrail: log("downloadAuditTrail", overrides.downloadAuditTrail ?? (async () => PDF)),
  };
  let fileSeq = 0;
  const storage = {
    provider: "gdrive",
    ensureFolder: async (root, path) => ({ id: `${root}:${path.join("|")}`, name: path.at(-1), link: null }),
    ensureChild: async (parent, name) => ({ id: `${parent.id}>${name}`, name, link: null }),
    uploadFile: log("uploadFile", async (folder, file, bytes) => ({
      id: `file-${++fileSeq}`, name: file.name, mimeType: file.mimeType, size: bytes.byteLength, modifiedAt: null,
      link: `https://drive.test/file-${fileSeq}`, folderIds: [folder.id], sha256: "abc", isFolder: false,
    })),
    download: log("download", async () => new Response(PDF)),
    trash: log("trash", async () => {}),
  };
  const docs = {
    readDocText: log("readDocText", readDocText ?? (async () => DOC_TEXT)),
    fillTemplate: log("fillTemplate", async () => ({ docCopyId: "copy-1", pdf: PDF })),
  };
  const handler = createSignaturesHandler({
    createClient: () => client,
    createYoutrust: () => youtrust,
    docs,
    storage: async () => storage,
    loadServiceAccount: async () => SA,
    now: () => new Date("2026-11-09T09:00:00Z"),
  });
  const count = (name) => calls.filter((c) => c.name === name).length;
  return { tables, ops, calls, count, client, youtrust, storage, async post(body) {
    const response = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: "POST", body, headers: { authorization: "Bearer t", origin: "https://admin.quicksort.test" } }, response);
    return response;
  } };
}

const templatePreview = (values = {}) => ({
  action: "preview", personId: PERSON, templateId: TEMPLATE,
  values: { prenom: "Ada", nom: "Lovelace", salaire_brut_mensuel: "3 500,00 €", clause_speciale: "Télétravail 2 jours", ...values },
  signers: [{ role: "person", name: "Ada Lovelace", email: "ada@example.test" }],
});

async function draft(f) {
  const r = await f.post(templatePreview());
  assert.equal(r.code, 200, JSON.stringify(r.body));
  return r.body.request;
}

test("a non-admin gets 403 for every action", async () => {
  const actions = ["get-settings", "save-settings", "list-templates", "save-template", "list-requests", "prepare", "preview", "send", "refresh", "cancel", "discard-draft"];
  for (const action of actions) {
    const f = fixture({ admin: false });
    const r = await f.post({ action });
    assert.equal(r.code, 403, action);
    assert.equal(r.body.error, "Admin access is required.");
    assert.equal(f.ops.length, 0);
  }
});

test("get-settings never returns the API key or webhook secret", async () => {
  const r = await fixture().post({ action: "get-settings" });
  assert.equal(r.code, 200);
  assert.equal(r.body.hasApiKey, true);
  assert.equal(r.body.hasWebhookSecret, true);
  assert.equal(r.body.signatoryName, "Mohamed Nah");
  assert.equal(r.body.serviceAccountEmail, SA.client_email);
  assert.equal(r.body.webhookUrl, "https://admin.quicksort.test/api/youtrust-webhook");
  const json = JSON.stringify(r.body);
  assert.ok(!json.includes(API_KEY) && !json.includes(WEBHOOK_SECRET) && !json.includes("encrypted"));
  assert.ok(!("apiKey" in r.body) && !("webhookSecret" in r.body));
});

test("save-settings keeps the stored secrets when they are absent", async () => {
  const f = fixture();
  const before = f.tables.signature_settings[0].encrypted_credentials;
  const r = await f.post({ action: "save-settings", staging: false, signatoryName: "M. Nah", signatoryEmail: "m@quicksort.test" });
  assert.equal(r.code, 200);
  assert.equal(r.body.hasApiKey, true);
  assert.equal(r.body.staging, false);
  assert.equal(f.tables.signature_settings[0].encrypted_credentials, before);
  assert.ok(!JSON.stringify(r.body).includes(API_KEY));
});

test("save-template with a Doc the service account cannot read → 400 naming the service account", async () => {
  const f = fixture({ readDocText: async (sa) => { throw new DocAccessError(sa.client_email); } });
  const r = await f.post({
    action: "save-template", name: "CDD", googleDocUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit",
    signers: "person_and_quicksort", typeCode: "EMPLOYMENT_CONTRACT", active: true,
  });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /sa@proj\.iam\.gserviceaccount\.com/);
  assert.equal(f.tables.signature_templates.length, 2);
});

test("save-template parses the Doc ID and returns its fields", async () => {
  const f = fixture();
  const r = await f.post({
    action: "save-template", name: "CDD", googleDocUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit",
    signers: "person", typeCode: "EMPLOYMENT_CONTRACT", active: true,
  });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.template.google_doc_id, "1AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(f.calls.find((c) => c.name === "readDocText").args[1], "1AbCdEfGhIjKlMnOpQrStUv");
  assert.deepEqual(r.body.fields, ["prenom", "nom", "salaire_brut_mensuel", "clause_speciale"]);
});

test("prepare marks known fields filled and unknown ones empty", async () => {
  const r = await fixture().post({ action: "prepare", personId: PERSON, templateId: TEMPLATE });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const salary = r.body.fields.find((x) => x.name === "salaire_brut_mensuel");
  assert.equal(salary.known, true);
  assert.equal(salary.value.replace(/[  ]/g, " "), "3 500,00 €");
  assert.deepEqual(r.body.fields.find((x) => x.name === "clause_speciale"), { name: "clause_speciale", value: "", known: false });
});

test("signer order: person then signatory, or the signatory alone", async () => {
  const f = fixture();
  const both = await f.post({ action: "prepare", personId: PERSON, templateId: TEMPLATE });
  assert.deepEqual(both.body.signers, [
    { role: "person", name: "Ada Lovelace", email: "ada@example.test", order: 0 },
    { role: "quicksort", name: "Mohamed Nah", email: "mohamed@quicksort.test", order: 1 },
  ]);
  const only = await f.post({ action: "prepare", personId: PERSON, templateId: QS_TEMPLATE });
  assert.deepEqual(only.body.signers, [{ role: "quicksort", name: "Mohamed Nah", email: "mohamed@quicksort.test", order: 1 }]);
});

test("preview refuses an empty value before filling the template", async () => {
  const f = fixture();
  const r = await f.post(templatePreview({ clause_speciale: "  " }));
  assert.equal(r.code, 400);
  assert.match(r.body.error, /Fill in: clause_speciale/);
  assert.equal(f.count("fillTemplate"), 0);
  assert.equal(f.count("uploadFile"), 0);
  assert.equal(f.tables.document_folders.length, 0, "no folder is created before the refusal");
  assert.equal(f.tables.signature_requests.length, 0);
});

test("preview fills the template into the person's folder and stores a draft", async () => {
  const f = fixture();
  const r = await f.post(templatePreview({ prenom: "Adèle" }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const fill = f.calls.find((c) => c.name === "fillTemplate").args[1];
  assert.equal(fill.templateDocId, "doc-cdi");
  assert.ok(fill.folderId.startsWith("people:"), fill.folderId);
  assert.equal(fill.values.prenom, "Adèle");
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "draft");
  assert.equal(row.doc_copy_file_id, "copy-1");
  assert.equal(row.pdf_file_id, "file-1");
  assert.equal(row.pdf_folder_id, fill.folderId);
  assert.equal(row.created_by, "user-1");
  assert.equal(r.body.request.id, row.id);
  assert.equal(Buffer.from(r.body.pdfBase64, "base64").toString(), Buffer.from(PDF).toString());
});

const OTHER = "66666666-6666-4666-8666-666666666666";
const APP = "77777777-7777-4777-8777-777777777777";
const OTHER_APP = "88888888-8888-4888-8888-888888888888";
const withApplications = (f) => {
  f.tables.hr_applications = [{ id: APP, person_id: PERSON }, { id: OTHER_APP, person_id: OTHER }];
  return f;
};

test("preview stores the application it was sent from", async () => {
  const f = withApplications(fixture());
  const r = await f.post({ ...templatePreview(), applicationId: APP });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.tables.signature_requests[0].application_id, APP);
  const list = await f.post({ action: "list-requests", personId: PERSON });
  assert.equal(list.body.requests[0].application_id, APP);
});

test("preview of a custom PDF also stores the application", async () => {
  const f = withApplications(fixture());
  const r = await f.post({
    action: "preview", personId: PERSON, title: "Avenant", typeCode: "EMPLOYMENT_CONTRACT", pdfBase64: Buffer.from(PDF).toString("base64"),
    signers: [{ role: "person", name: "Ada L.", email: "ada@example.test" }], applicationId: APP,
  });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.tables.signature_requests[0].application_id, APP);
});

test("preview with another person's application (or none) → 400 and nothing inserted", async () => {
  for (const applicationId of [OTHER_APP, "99999999-9999-4999-8999-999999999999"]) {
    const f = withApplications(fixture());
    const r = await f.post({ ...templatePreview(), applicationId });
    assert.equal(r.code, 400);
    assert.match(JSON.stringify(r.body), /Application does not belong to this person\./);
    assert.equal(f.tables.signature_requests?.length ?? 0, 0);
    assert.equal(f.count("uploadFile"), 0);
  }
});

const HIRE_TEXT = "{{poste}} {{type_contrat}} {{salaire_brut_mensuel}} {{date_debut}} {{matricule}}";
const rehireFixture = () => {
  const f = withApplications(fixture({ readDocText: async () => HIRE_TEXT }));
  f.tables.employees[0].status = "ended";
  f.tables.hr_applications.push({ id: OTHER, person_id: PERSON });
  f.tables.offers = [
    { id: "o-old", application_id: OTHER, status: "accepted", title: "Data Engineer", contract_type: "CDD", salary_monthly: 3500, cjm: 0, created_at: "2025-12-01" },
    { id: "o-new", application_id: APP, status: "accepted", title: "Lead Engineer", contract_type: "CDI", salary_monthly: 5200, cjm: 0, created_at: "2026-10-01" },
  ];
  return f;
};
const fieldMap = (r) => Object.fromEntries(r.body.fields.map((x) => [x.name, x.value.replace(/[  ]/g, " ")]));

test("prepare with an application prefills from its accepted offer, not the ended employment", async () => {
  const f = rehireFixture();
  f.tables.offers[1].created_at = "2025-01-01"; // older than the other application's offer: still the one used
  const r = await f.post({ action: "prepare", personId: PERSON, templateId: TEMPLATE, applicationId: APP });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(fieldMap(r), { poste: "Lead Engineer", type_contrat: "CDI", salaire_brut_mensuel: "5 200,00 €", date_debut: "", matricule: "" });
});

test("prepare without an application uses the latest accepted offer when no employment is open", async () => {
  const r = await rehireFixture().post({ action: "prepare", personId: PERSON, templateId: TEMPLATE });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(fieldMap(r), { poste: "Lead Engineer", type_contrat: "CDI", salaire_brut_mensuel: "5 200,00 €", date_debut: "", matricule: "" });
});

test("prepare with another person's application (or none) → 400", async () => {
  for (const applicationId of [OTHER_APP, "99999999-9999-4999-8999-999999999999"]) {
    const r = await rehireFixture().post({ action: "prepare", personId: PERSON, templateId: TEMPLATE, applicationId });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "Application does not belong to this person.");
  }
});

test("preview of a custom upload that is not a PDF → 400", async () => {
  const f = fixture();
  const r = await f.post({
    action: "preview", personId: PERSON, title: "Avenant", typeCode: "EMPLOYMENT_CONTRACT",
    pdfBase64: Buffer.from("not a pdf at all").toString("base64"),
    signers: [{ role: "person", name: "Ada Lovelace", email: "ada@example.test" }, { role: "quicksort", name: "x", email: "x@x.test" }],
  });
  assert.equal(r.code, 400);
  assert.equal(f.count("uploadFile"), 0);
});

test("preview of a custom PDF stores a draft with the settings signatory", async () => {
  const f = fixture();
  const r = await f.post({
    action: "preview", personId: PERSON, title: "Avenant", typeCode: "EMPLOYMENT_CONTRACT", pdfBase64: Buffer.from(PDF).toString("base64"),
    signers: [{ role: "person", name: "Ada L.", email: "ada@example.test" }, { role: "quicksort", name: "Someone", email: "evil@example.test" }],
  });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const row = f.tables.signature_requests[0];
  assert.equal(row.template_id, null);
  assert.deepEqual(row.signers, [
    { role: "person", name: "Ada L.", email: "ada@example.test", order: 0 },
    { role: "quicksort", name: "Mohamed Nah", email: "mohamed@quicksort.test", order: 1 },
  ]);
});

test("send twice: Youtrust is called once, the second send is 409", async () => {
  const f = fixture();
  const request = await draft(f);
  const first = await f.post({ action: "send", requestId: request.id });
  assert.equal(first.code, 200, JSON.stringify(first.body));
  const second = await f.post({ action: "send", requestId: request.id });
  assert.equal(second.code, 409);
  assert.equal(second.body.error, "Already sent.");
  assert.equal(f.count("createRequest"), 1);
  const input = f.calls.find((c) => c.name === "createRequest").args[0];
  assert.equal(input.externalId, request.id);
  assert.deepEqual(input.signers, [
    { name: "Ada Lovelace", email: "ada@example.test", order: 0 },
    { name: "Mohamed Nah", email: "mohamed@quicksort.test", order: 1 },
  ]);
  const row = f.tables.signature_requests[0];
  assert.deepEqual(f.calls.filter((c) => c.name === "download").map((c) => c.args[0]), [request.pdf_file_id]);
  assert.equal(row.status, "sent");
  assert.equal(row.youtrust_request_id, "yt-1");
  assert.equal(row.youtrust_document_id, "ytd-1");
});

test("send when Youtrust fails → status error and 502", async () => {
  const f = fixture({ youtrust: { createRequest: async () => { throw new YoutrustError("Youtrust POST /signature_requests failed (500)", 500); } } });
  const request = await draft(f);
  const r = await f.post({ action: "send", requestId: request.id });
  assert.equal(r.code, 502);
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "error");
  assert.match(row.error, /failed \(500\)/);
});

test("refresh moves to signed_by_person, then files once on completion", async () => {
  let remote = { status: "ongoing", signers: [{ email: "ADA@example.test", status: "signed" }] };
  const f = fixture({ youtrust: { getStatus: async () => remote } });
  const request = await draft(f);
  await f.post({ action: "send", requestId: request.id });
  const signed = await f.post({ action: "refresh", requestId: request.id });
  assert.equal(signed.code, 200, JSON.stringify(signed.body));
  assert.equal(f.tables.signature_requests[0].status, "signed_by_person");

  remote = { status: "done", signers: [] };
  const done = await f.post({ action: "refresh", requestId: request.id });
  assert.equal(done.code, 200, JSON.stringify(done.body));
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "completed");
  const [contract, audit] = f.tables.documents;
  assert.equal(row.signed_document_id, contract.id);
  assert.equal(row.audit_document_id, audit.id);
  assert.equal(contract.type_code, "EMPLOYMENT_CONTRACT");
  assert.equal(contract.issued_on, "2026-11-09");
  assert.equal(audit.type_code, "OTHER");
  assert.equal(audit.parent_document_id, contract.id);

  await f.post({ action: "refresh", requestId: request.id });
  assert.equal(f.tables.documents.length, 2);
  assert.equal(f.count("downloadSigned"), 1);
});

test("refresh never moves a cancelled request", async () => {
  const f = fixture({ youtrust: { getStatus: async () => ({ status: "done", signers: [] }) } });
  const request = await draft(f);
  await f.post({ action: "send", requestId: request.id });
  const cancelled = await f.post({ action: "cancel", requestId: request.id });
  assert.equal(cancelled.code, 200);
  assert.equal(f.count("cancel"), 1);
  await f.post({ action: "refresh", requestId: request.id });
  assert.equal(f.tables.signature_requests[0].status, "cancelled");
  assert.equal(f.count("downloadSigned"), 0);
});

test("discard-draft trashes the draft's files and deletes the row", async () => {
  const f = fixture();
  const request = await draft(f);
  const r = await f.post({ action: "discard-draft", requestId: request.id });
  assert.equal(r.code, 200);
  assert.deepEqual(f.calls.filter((c) => c.name === "trash").map((c) => c.args[0]).sort(), ["copy-1", "file-1"]);
  assert.equal(f.tables.signature_requests.length, 0);
});

test("list-requests returns the person's requests, newest first", async () => {
  const f = fixture();
  const a = await draft(f);
  const b = await draft(f);
  const r = await f.post({ action: "list-requests", personId: PERSON });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.requests.map((x) => x.id), [b.id, a.id]);
});

test("save-settings replacing one secret keeps the other", async () => {
  const f = fixture();
  const r = await f.post({ action: "save-settings", staging: true, signatoryName: "Mohamed Nah", signatoryEmail: "mohamed@quicksort.test", apiKey: "new-api-key" });
  assert.equal(r.code, 200);
  const stored = await loadSignatureSettings(f.client);
  assert.equal(stored.apiKey, "new-api-key");
  assert.equal(stored.webhookSecret, WEBHOOK_SECRET);
});

test("send can be retried from error", async () => {
  let fail = true;
  const f = fixture({ youtrust: { createRequest: async () => {
    if (fail) throw new YoutrustError("Youtrust down", 503);
    return { requestId: "yt-2", documentId: "ytd-2" };
  } } });
  const request = await draft(f);
  assert.equal((await f.post({ action: "send", requestId: request.id })).code, 502);
  fail = false;
  const retry = await f.post({ action: "send", requestId: request.id });
  assert.equal(retry.code, 200, JSON.stringify(retry.body));
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "sent");
  assert.equal(row.error, "");
  assert.equal(row.youtrust_request_id, "yt-2");
  assert.equal(f.count("createRequest"), 2);
});

test("send that cannot store the Youtrust ids → error naming them, logged", async () => {
  const f = fixture({ failures: (table, mode, payload) =>
    table === "signature_requests" && mode === "update" && payload?.status === "sent" ? { message: "db down", code: "08006" } : null });
  const request = await draft(f);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const r = await f.post({ action: "send", requestId: request.id });
    assert.equal(r.code, 502);
    assert.match(r.body.error, /yt-1.*ytd-1/);
  } finally {
    console.error = original;
  }
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "error");
  assert.match(row.error, /Youtrust request yt-1, document ytd-1/);
  assert.ok(logged.some((line) => line.includes("yt-1") && line.includes("ytd-1")));
});

test("cancel on a stale sending row marks it interrupted; a recent one is 409", async () => {
  const f = fixture();
  const request = await draft(f);
  const row = f.tables.signature_requests[0];
  Object.assign(row, { status: "sending", updated_at: "2026-11-09T08:59:00Z" });
  const recent = await f.post({ action: "cancel", requestId: request.id });
  assert.equal(recent.code, 409);
  assert.equal(row.status, "sending");
  row.updated_at = "2026-11-09T08:57:00Z";
  const stale = await f.post({ action: "cancel", requestId: request.id });
  assert.equal(stale.code, 200, JSON.stringify(stale.body));
  assert.equal(row.status, "error");
  assert.equal(row.error, "The send was interrupted. Check Youtrust before sending again.");
  assert.equal(f.count("cancel"), 0);
});

test("cancelling a draft is local", async () => {
  const f = fixture();
  const request = await draft(f);
  const r = await f.post({ action: "cancel", requestId: request.id });
  assert.equal(r.code, 200);
  assert.equal(f.tables.signature_requests[0].status, "cancelled");
  assert.equal(f.count("cancel"), 0);
});

test("discard-draft refuses a sent request and keeps its files", async () => {
  const f = fixture();
  const request = await draft(f);
  await f.post({ action: "send", requestId: request.id });
  const r = await f.post({ action: "discard-draft", requestId: request.id });
  assert.equal(r.code, 409);
  assert.equal(f.count("trash"), 0);
  assert.equal(f.tables.signature_requests.length, 1);
});

async function sentRequest(f) {
  const request = await draft(f);
  await f.post({ action: "send", requestId: request.id });
  return request;
}

test("two concurrent completions file the signed document once", async () => {
  const f = fixture();
  const request = await sentRequest(f);
  const now = new Date("2026-11-09T09:00:00Z");
  await Promise.all([
    completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now),
    completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now),
  ]);
  assert.equal(f.count("downloadSigned"), 1);
  assert.equal(f.tables.documents.filter((d) => d.type_code === "EMPLOYMENT_CONTRACT").length, 1);
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "completed");
  assert.equal(row.filing_claimed_at, now.toISOString());
});

test("a failed filing releases the claim; the retry files only what is missing", async () => {
  let failAudit = true;
  const f = fixture({ youtrust: { downloadAuditTrail: async () => { if (failAudit) throw new Error("audit not ready"); return PDF; } } });
  const request = await sentRequest(f);
  const now = new Date("2026-11-09T09:00:00Z");
  await assert.rejects(completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now), /audit not ready/);
  const row = f.tables.signature_requests[0];
  assert.equal(row.filing_claimed_at, null);
  assert.ok(row.signed_document_id);
  assert.equal(row.status, "sent");
  failAudit = false;
  await completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now);
  assert.equal(f.count("downloadSigned"), 1);
  assert.equal(f.tables.documents.length, 2);
  assert.equal(row.status, "completed");
});

test("a live claim held elsewhere makes completion a no-op; an abandoned one is taken over", async () => {
  const f = fixture();
  const request = await sentRequest(f);
  const row = f.tables.signature_requests[0];
  row.filing_claimed_at = "2026-11-09T08:58:00.000Z";
  await completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, new Date("2026-11-09T09:00:00Z"));
  assert.equal(f.count("downloadSigned"), 0);
  await completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, new Date("2026-11-09T09:04:00Z"));
  assert.equal(f.count("downloadSigned"), 1);
  assert.equal(row.status, "completed");
});

test("a document to replace that changed before completion: filed as new, with a note", async () => {
  const f = fixture();
  const OLD = "77777777-7777-4777-8777-777777777777";
  f.tables.documents.push({ id: OLD, person_id: PERSON, type_code: "EMPLOYMENT_CONTRACT", status: "active" });
  const r = await f.post({ ...templatePreview(), supersedes: OLD });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  await f.post({ action: "send", requestId: r.body.request.id });
  f.tables.documents[0].status = "superseded";

  await completeRequest(f.client, f.youtrust, f.storage, { id: r.body.request.id }, new Date("2026-11-09T09:00:00Z"));
  const row = f.tables.signature_requests[0];
  assert.equal(row.status, "completed");
  assert.ok(row.signed_document_id);
  const filed = f.ops.filter((o) => o.op === "rpc" && o.value.document.type_code === "EMPLOYMENT_CONTRACT");
  assert.equal(filed.length, 1);
  assert.equal(filed[0].value.supersedes, null);
  assert.equal(row.error, SUPERSEDES_CHANGED_NOTE);
});

test("a document to replace that is still active is replaced, and no note is left", async () => {
  const f = fixture();
  const OLD = "77777777-7777-4777-8777-777777777777";
  f.tables.documents.push({ id: OLD, person_id: PERSON, type_code: "EMPLOYMENT_CONTRACT", status: "active" });
  const r = await f.post({ ...templatePreview(), supersedes: OLD });
  await f.post({ action: "send", requestId: r.body.request.id });
  await completeRequest(f.client, f.youtrust, f.storage, { id: r.body.request.id }, new Date("2026-11-09T09:00:00Z"));
  const filed = f.ops.find((o) => o.op === "rpc" && o.value.document.type_code === "EMPLOYMENT_CONTRACT");
  assert.equal(filed.value.supersedes, OLD);
  assert.equal(f.tables.signature_requests[0].error, "");
});

test("the replacement note survives a failed audit trail and the retry", async () => {
  let failAudit = true;
  const f = fixture({ youtrust: { downloadAuditTrail: async () => { if (failAudit) throw new Error("audit not ready"); return PDF; } } });
  const OLD = "77777777-7777-4777-8777-777777777777";
  f.tables.documents.push({ id: OLD, person_id: PERSON, type_code: "EMPLOYMENT_CONTRACT", status: "active" });
  const r = await f.post({ ...templatePreview(), supersedes: OLD });
  await f.post({ action: "send", requestId: r.body.request.id });
  f.tables.documents[0].status = "archived";
  const now = new Date("2026-11-09T09:00:00Z");
  await assert.rejects(completeRequest(f.client, f.youtrust, f.storage, { id: r.body.request.id }, now), /audit not ready/);
  const row = f.tables.signature_requests[0];
  assert.match(row.error, /The document it was meant to replace changed/);
  assert.match(row.error, /audit not ready/);
  failAudit = false;
  await completeRequest(f.client, f.youtrust, f.storage, { id: r.body.request.id }, now);
  assert.equal(row.status, "completed");
  assert.equal(row.error, SUPERSEDES_CHANGED_NOTE);
});

test("a failing completion writes its reason to error; a later success clears it", async () => {
  let fail = true;
  const f = fixture({ youtrust: { downloadSigned: async () => { if (fail) throw new Error("Youtrust is down"); return PDF; } } });
  const request = await sentRequest(f);
  const now = new Date("2026-11-09T09:00:00Z");
  await assert.rejects(completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now), /Youtrust is down/);
  const row = f.tables.signature_requests[0];
  assert.match(row.error, /Filing the signed documents failed: Youtrust is down/);
  assert.equal(row.status, "sent");
  fail = false;
  await completeRequest(f.client, f.youtrust, f.storage, { id: request.id }, now);
  assert.equal(row.status, "completed");
  assert.equal(row.error, "");
});

test("a database refusal (P0001) while filing surfaces as 400 with its message", async () => {
  const f = fixture({
    youtrust: { getStatus: async () => ({ status: "done", signers: [] }) },
    failures: (table, mode) => table === "register_signed_document" && mode === "rpc"
      ? { message: "This person is archived.", code: "P0001" } : null,
  });
  const request = await sentRequest(f);
  const r = await f.post({ action: "refresh", requestId: request.id });
  assert.equal(r.code, 400);
  assert.deepEqual(r.body, { error: "This person is archived." });
  assert.match(f.tables.signature_requests[0].error, /This person is archived/);
});

test("discard-draft succeeds even when trashing its files fails", async () => {
  const f = fixture();
  const request = await draft(f);
  f.storage.trash = async () => { throw new Error("Drive is down"); };
  const r = await f.post({ action: "discard-draft", requestId: request.id });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { deleted: true });
  assert.equal(f.tables.signature_requests.length, 0);
});

test("credentials that cannot be decrypted read as absent and can be replaced from Settings", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const f = fixture();
  f.tables.signature_settings[0].encrypted_credentials = "v1:not-a-valid-ciphertext";
  const r = await f.post({ action: "get-settings" });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.hasApiKey, false);
  assert.equal(r.body.hasWebhookSecret, false);
  assert.ok(logged.mock.callCount() >= 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /cannot be decrypted/);

  const saved = await f.post({ action: "save-settings", staging: true, signatoryName: "Mohamed Nah", signatoryEmail: "mohamed@quicksort.test", apiKey: "new-api-key", webhookSecret: "new-secret" });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.hasApiKey, true);
  const stored = await loadSignatureSettings(f.client);
  assert.equal(stored.apiKey, "new-api-key");
  assert.equal(stored.webhookSecret, "new-secret");
});
