import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createYoutrustWebhookHandler } from "../apps/admin/api/youtrust-webhook.ts";
import { encryptSignatureCredentials } from "../apps/admin/server/signatures/settings.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);

const WEBHOOK_SECRET = "youtrust-webhook-secret";
const PERSON = "22222222-2222-4222-8222-222222222222";
const REQUEST = "66666666-6666-4666-8666-666666666666";
const PDF = new Uint8Array([...Buffer.from("%PDF-1.7 synthetic contract")]);
const NOW = new Date("2026-11-09T09:00:00Z");
// Inserts into these tables fail with 23505 on a repeated key, like the real primary key.
const PRIMARY_KEYS = { signature_webhook_events: "event_id" };

// In-memory Supabase (copied from tests/signatures-api.test.mjs, plus PRIMARY_KEYS): tables are arrays,
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
            const pk = PRIMARY_KEYS[table];
            if (pk && rows.some((r) => r[pk] === v[pk])) return { data: null, error: { message: "duplicate key", code: "23505" } };
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

function fixture({ status = "sent", youtrust: overrides = {}, webhookSecret = WEBHOOK_SECRET } = {}) {
  const tables = {
    hr_people: [{ id: PERSON, full_name: "Ada Lovelace", email: "ada@example.test" }],
    document_types: [
      { code: "EMPLOYMENT_CONTRACT", label: "Contrat de travail", owner_kinds: ["person"], folder: "contrat_travail", requires_expiry: false },
      { code: "OTHER", label: "Autre", owner_kinds: ["person", "client", "project"], folder: "divers", requires_expiry: false },
    ],
    document_folders: [],
    documents: [],
    signature_settings: [{
      id: "default",
      options: { staging: true, signatory_name: "Mohamed Nah", signatory_email: "mohamed@quicksort.test" },
      encrypted_credentials: encryptSignatureCredentials({ apiKey: "api-key", webhookSecret }),
    }],
    signature_requests: [{
      id: REQUEST, person_id: PERSON, title: "Contrat CDI", type_code: "EMPLOYMENT_CONTRACT", supersedes: null,
      status, error: "", youtrust_request_id: "yt-1",
      signers: [
        { role: "person", name: "Ada Lovelace", email: "ada@example.test", order: 0 },
        { role: "quicksort", name: "Mohamed Nah", email: "mohamed@quicksort.test", order: 1 },
      ], signed_document_id: null, audit_document_id: null, filing_claimed_at: null,
    }],
    signature_webhook_events: [],
  };
  const ops = [];
  const calls = [];
  const log = (name, fn) => async (...args) => { calls.push({ name, args }); return fn(...args); };
  const client = memoryClient(tables, ops);
  const youtrust = {
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
  };
  const handler = createYoutrustWebhookHandler({
    createClient: () => client,
    createYoutrust: () => youtrust,
    storage: async () => storage,
    now: () => NOW,
  });
  const count = (name) => calls.filter((c) => c.name === name).length;
  const writes = () => ops.filter((o) => o.op !== "select");
  return {
    tables, writes, count, row: tables.signature_requests[0],
    async deliver(event, { signature, headerName = "x-yousign-signature-256" } = {}) {
      const raw = JSON.stringify(event);
      const header = signature ?? "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
      // The handler's contract: the raw body is read from the request stream
      // (an async iterable of byte chunks); req.body is never touched.
      const req = {
        method: "POST",
        headers: { "content-type": "application/json", [headerName]: header },
        get body() { throw new Error("req.body must not be read"); },
        async *[Symbol.asyncIterator]() { yield Buffer.from(raw.slice(0, 10)); yield Buffer.from(raw.slice(10)); },
      };
      const response = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(b) { this.body = b; return this; } };
      await handler(req, response);
      return response;
    },
  };
}

const event = (event_name, extra = {}, id = `evt-${event_name}`) => ({
  event_id: id, event_name, event_time: "1762678800", sandbox: true,
  data: { signature_request: { id: "yt-1" }, ...extra },
});
const done = () => event("signature_request.done");

test("a bad signature is rejected with 401 and nothing is written", async () => {
  const f = fixture();
  const r = await f.deliver(done(), { signature: "sha256=" + "0".repeat(64) });
  assert.equal(r.code, 401);
  assert.deepEqual(f.writes(), []);
  assert.equal(f.row.status, "sent");
});

test("with no webhook secret configured, a delivery is rejected with 401 and nothing is written", async () => {
  const f = fixture({ webhookSecret: null });
  const r = await f.deliver(done());
  assert.equal(r.code, 401);
  assert.deepEqual(f.writes(), []);
});

test("the signature header is found whatever its case", async () => {
  const f = fixture();
  const r = await f.deliver(event("signature_request.declined"), { headerName: "X-Yousign-Signature-256" });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.row.status, "declined");
});

test("signer.done for the person moves the request to signed_by_person", async () => {
  const f = fixture();
  const r = await f.deliver(event("signer.done", { signer: { info: { email: "ADA@example.test" } } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.row.status, "signed_by_person");
  assert.deepEqual(f.tables.signature_webhook_events.map((e) => e.event_id), ["evt-signer.done"]);
});

test("signer.done matches the signer email the request was sent to, not the person's record", async () => {
  const f = fixture();
  f.row.signers[0].email = "ada.personal@example.test";
  const other = await f.deliver(event("signer.done", { signer: { info: { email: "ada@example.test" } } }, "evt-1"));
  assert.equal(other.code, 200);
  assert.equal(f.row.status, "sent");
  const r = await f.deliver(event("signer.done", { signer: { info: { email: "Ada.Personal@example.test" } } }, "evt-2"));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.row.status, "signed_by_person");
});

test("signer.done for another signer leaves the status alone", async () => {
  const f = fixture();
  const r = await f.deliver(event("signer.done", { signer: { info: { email: "mohamed@quicksort.test" } } }));
  assert.equal(r.code, 200);
  assert.equal(f.row.status, "sent");
});

test("signature_request.done files the contract, then the audit trail, and completes", async () => {
  const f = fixture({ status: "signed_by_person" });
  const r = await f.deliver(done());
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(f.count("uploadFile"), 2);
  const [contract, audit] = f.tables.documents;
  assert.equal(contract.type_code, "EMPLOYMENT_CONTRACT");
  assert.equal(contract.issued_on, "2026-11-09");
  assert.equal(audit.type_code, "OTHER");
  assert.equal(audit.parent_document_id, contract.id);
  assert.equal(f.row.signed_document_id, contract.id);
  assert.equal(f.row.audit_document_id, audit.id);
  assert.equal(f.row.status, "completed");
});

test("the same done event delivered twice files one signed document", async () => {
  const f = fixture();
  const first = await f.deliver(done());
  const second = await f.deliver(done());
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.equal(second.code, 200);
  assert.deepEqual(second.body, { duplicate: true });
  assert.equal(f.count("downloadSigned"), 1);
  assert.equal(f.tables.documents.filter((d) => d.type_code === "EMPLOYMENT_CONTRACT").length, 1);
});

test("a done event for an unknown request returns 200 and writes nothing", async () => {
  const f = fixture();
  const r = await f.deliver({ ...done(), data: { signature_request: { id: "yt-unknown" } } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ignored: true });
  assert.deepEqual(f.writes(), []);
  assert.equal(f.count("downloadSigned"), 0);
});

test("a failed audit-trail download returns 500, removes the event, and the redelivery files only the audit trail", async () => {
  let failAudit = true;
  const f = fixture({ youtrust: { downloadAuditTrail: async () => { if (failAudit) throw new Error("audit not ready"); return PDF; } } });
  const r = await f.deliver(done());
  assert.equal(r.code, 500);
  assert.deepEqual(f.tables.signature_webhook_events, []);
  assert.ok(f.row.signed_document_id);
  assert.equal(f.row.audit_document_id, null);
  assert.equal(f.row.status, "sent");

  failAudit = false;
  const retry = await f.deliver(done());
  assert.equal(retry.code, 200, JSON.stringify(retry.body));
  assert.equal(f.count("downloadSigned"), 1);
  assert.equal(f.count("uploadFile"), 2);
  assert.equal(f.tables.documents.length, 2);
  assert.equal(f.row.status, "completed");
});

test("a done event while another caller holds the filing claim returns 503 and removes the event", async () => {
  const f = fixture();
  f.row.filing_claimed_at = "2026-11-09T08:59:00.000Z";
  const r = await f.deliver(done());
  assert.equal(r.code, 503);
  assert.deepEqual(f.tables.signature_webhook_events, []);
  assert.equal(f.count("downloadSigned"), 0);
  assert.equal(f.row.status, "sent");
});

test("done after cancelled leaves the request cancelled", async () => {
  const f = fixture({ status: "cancelled" });
  const r = await f.deliver(done());
  assert.equal(r.code, 200);
  assert.equal(f.row.status, "cancelled");
  assert.equal(f.count("downloadSigned"), 0);
  assert.deepEqual(f.tables.documents, []);
});

test("a late activated event never moves a request back from signed_by_person", async () => {
  const f = fixture({ status: "signed_by_person" });
  const r = await f.deliver(event("signature_request.activated"));
  assert.equal(r.code, 200);
  assert.equal(f.row.status, "signed_by_person");
});
