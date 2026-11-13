# Youtrust Contract Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins fill a Google Docs template (or upload a custom PDF) for a person, send it for signature through Youtrust, follow its status, and get the signed PDF and audit trail filed into the person's Documents automatically.

**Architecture:** Follows the Qonto invoicing integration. A provider client (`server/signatures/youtrust.ts`, injectable `fetch`) holds the API calls. Settings are encrypted in a settings table, as `server/invoicing/settings.ts` does. One admin-only handler (`api/signatures.ts`) receives `{ action }` POSTs. A separate webhook function (`api/youtrust-webhook.ts`) runs with the service role, verifies the HMAC, updates the request and files the result. Filing reuses the documents registry through a new server-side `fileBuffer` helper and a service-role-only `register_signed_document` SQL function.

**Tech Stack:** TypeScript, Vercel Node functions, Supabase (Postgres + RLS), zod, Google Drive and Docs REST APIs (existing service account), Youtrust (Yousign v3) REST API, React and `@quicksort-sas/ui`, `node --test`, psql SQL tests.

**Spec:** `docs/superpowers/specs/2026-11-09-youtrust-contract-signing-design.md`

## Global Constraints

- Admins only: every `api/signatures.ts` action checks `user_roles.role === "admin"`, as `api/invoicing.ts:213` does. RLS on the new tables uses `private.is_admin()`.
- The Youtrust API key and webhook secret are never sent to the browser. They are encrypted with `encryptSecret(..., "quicksort/signatures/v1")` from `server/ai-settings.ts`.
- Template fields have the form `{{field_name}}`, matching `/\{\{\s*([a-z0-9_]+)\s*\}\}/g`.
- A request is never sent while any field value is empty, or while the filled PDF's text still contains `{{`.
- The PDF HR previewed is the PDF sent: send uploads the stored preview file (by Drive ID), not a regenerated one.
- Signer order for `person_and_quicksort`: the person first, the Quicksort signatory second.
- Signature level: simple (`signature_level: "electronic_signature"` in Yousign v3 terms). Delivery by email (`delivery_mode: "email"`).
- Custom PDFs: `application/pdf` only, 10 MB maximum.
- Filled Docs and PDFs live under the person's folder in the **people** Drive root, never the clients root.
- Money is formatted with `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })` and dates as `dd/mm/yyyy`.
- Before writing `youtrust.ts`, read the current API reference (developers.yousign.com, or its Youtrust successor). Confirm the base URLs (production `https://api.yousign.app/v3`, sandbox `https://api-sandbox.yousign.app/v3` as of 2025), the request and field shapes, and the exact `X-Yousign-Signature-256` construction. Record what you confirmed in a comment at the top of the file.
- No real contracts in fixtures. Use synthetic PDFs (a few bytes starting with `%PDF-`) and mocked Google and Youtrust calls.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Duplicate or replayed webhook events** (Youtrust retries, or the same event delivered twice) must not file the signed PDF twice. Test it in Task 7: deliver `signature_request.done` twice and assert one `documents` row.
2. **A "done" event arriving before the request is stored** (a race at send time) must not 500 forever. The webhook returns 200, ignores an unknown request ID, and "Refresh" recovers it. Test it in Task 7.
3. **A field left blank, or a `{{field}}` missed by the replacement** (a typo in the Doc, or a field split across text runs) must block sending. Test it in Task 4 (`assertNoPlaceholders`) and Task 6 (send refused when a value is empty).
4. **A Doc that isn't shared with the service account** must give a clear "share this Doc with <email>" error, not a raw 404. Test it in Task 4 and Task 6.
5. **Double-clicking send** must not create two Youtrust requests. `send` only proceeds from `draft` with a conditional update (`status = 'draft'` → `sending`). Test it in Task 6.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261221090000_signature_requests.sql` | tables, RLS, `PROBATION_LETTER` type, `private.insert_document`, `register_signed_document` |
| `tests/signatures.sql` | SQL assertions (RLS, filing function) |
| `apps/admin/server/signatures/settings.ts` | load and save encrypted Youtrust settings |
| `apps/admin/server/signatures/youtrust.ts` | Youtrust REST client |
| `apps/admin/server/signatures/webhook.ts` | HMAC verification, event → status mapping |
| `apps/admin/server/signatures/fields.ts` | field extraction, known values, formatting |
| `apps/admin/server/signatures/google-docs.ts` | copy a Doc, read its text, replace fields, export PDF |
| `apps/admin/server/documents/file.ts` | `fileBuffer`: upload bytes and register them in the registry |
| `apps/admin/api/signatures.ts` | admin actions |
| `apps/admin/api/youtrust-webhook.ts` | webhook receiver |
| `apps/admin/src/signatures/SignatureSettings.tsx` | settings tab: credentials, signatory, templates |
| `apps/admin/src/signatures/PersonSignatures.tsx` | person page section: list, send, refresh, cancel |
| `apps/admin/src/signatures/client.ts` | typed `postSignatures(action)` fetch helper |

---

### Task 1: Database

**Files:**
- Create: `supabase/migrations/20261221090000_signature_requests.sql`
- Create: `tests/signatures.sql`
- Modify: `scripts/verify-hr-database.mjs` (run `tests/signatures.sql` after `tests/documents.sql`)
- Modify: `packages/hr-db/src/database.types.ts` (add the new tables and function)

**Interfaces:**
- Produces:
  - `public.signature_settings(id text pk default 'default', options jsonb not null default '{}', encrypted_credentials text, updated_at timestamptz)`. `options` holds `{ staging: boolean, signatory_name: string, signatory_email: string }`.
  - `public.signature_templates(id uuid pk, name text not null unique, google_doc_id text not null, signers text not null check in ('person_and_quicksort','person','quicksort'), type_code text not null references document_types(code), active boolean not null default true, created_by uuid, created_at, updated_at)`
  - `public.signature_requests(id uuid pk, person_id uuid not null references hr_people, template_id uuid references signature_templates, title text not null, type_code text not null references document_types(code), signers jsonb not null, field_values jsonb not null default '{}', supersedes uuid references documents(id), status text not null check in ('draft','sending','sent','signed_by_person','completed','declined','expired','cancelled','error'), error text not null default '', youtrust_request_id text unique, youtrust_document_id text, doc_copy_file_id text, pdf_file_id text, pdf_folder_id text, signed_document_id uuid references documents(id), audit_document_id uuid references documents(id), created_by uuid not null references profiles(id), created_at, updated_at, status_changed_at timestamptz)`. `signers` is `[{ role: 'person'|'quicksort', name, email, order }]`.
  - `public.signature_webhook_events(event_id text pk, received_at timestamptz default now())` for idempotency.
  - The document type `('PROBATION_LETTER','Courrier période d''essai','{person}','contrat_travail',false,null,'{}',false,'{}',null,35)`.
  - `private.insert_document(document jsonb, supersedes uuid, request_id uuid, actor uuid) returns public.documents`: the body of today's `register_document` from `select * into t` onwards, with `actor` passed in.
  - `public.register_document(...)`: recreated as `actor` + `can_manage_document` checks, then `return private.insert_document(document, supersedes, request_id, actor)`. Signature and grants unchanged.
  - `public.register_signed_document(signature_request uuid, document jsonb, supersedes uuid) returns public.documents`: security definer. It loads the request (raises `'Unknown signature request.'` if missing) and calls `private.insert_document` with `actor := request.created_by` and `request_id := signature_request`. `revoke all from public; grant execute to service_role` only.

- [ ] **Step 1: Write `tests/signatures.sql`.** Seed users and people the way `tests/invoicing.sql` does (an admin, an `hr` user, an employee linked to a person), then assert:
  - the admin can insert and select `signature_templates` and `signature_requests`;
  - the `hr` user and the employee select **0** rows from both, and their inserts fail;
  - `register_signed_document` called as `authenticated` raises a permission error;
  - called as `service_role` with a draft request created by the admin, it inserts a `documents` row with `uploaded_by` = the admin and `type_code = 'EMPLOYMENT_CONTRACT'`, and appends an `hr_events` row with `request_id` = the request ID;
  - with `supersedes` = an active document of the same person, the old document becomes `superseded`;
  - `register_document` still works for the admin, which guards the refactor.
- [ ] **Step 2: Run `pnpm test:hr-db`.** Expected: FAIL (the relation `signature_templates` does not exist).
- [ ] **Step 3: Write the migration** with the interfaces above. Enable RLS on all four tables with admin-only policies (`using (private.is_admin()) with check (private.is_admin())`). `signature_webhook_events` and `signature_settings` get no policies, so only the server and service role can use them. Add `updated_at` triggers as other tables do.
- [ ] **Step 4: Run `pnpm test:hr-db`.** Expected: PASS, including the existing `documents.sql` and `my-documents.sql` suites.
- [ ] **Step 5: Update `database.types.ts`** for the new tables and `register_signed_document`, by hand in the existing style. Run `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** (`feat(signatures): tables, probation letter type, service-role filing`).

### Task 2: Settings and Youtrust client

**Files:**
- Create: `apps/admin/server/signatures/settings.ts`, `apps/admin/server/signatures/youtrust.ts`
- Test: `tests/youtrust-client.test.mjs`

**Interfaces:**
- Produces (`settings.ts`):
  - `SIGNATURES_AAD = "quicksort/signatures/v1"`
  - `type SignatureSettings = { staging: boolean; signatoryName: string; signatoryEmail: string; hasApiKey: boolean; hasWebhookSecret: boolean }`
  - `type SignatureCredentials = { apiKey: string | null; webhookSecret: string | null }`
  - `encryptSignatureCredentials(c: SignatureCredentials): string`
  - `loadSignatureSettings(client: SupabaseClient): Promise<SignatureSettings & SignatureCredentials>`
  - `youtrustFromSettings(s, fetchImpl?): YoutrustClient` throws `NotConfiguredError("Connect Youtrust in Settings → Signatures first.")` without an API key.
- Produces (`youtrust.ts`):
  - `type YoutrustSigner = { name: string; email: string; order: number }`
  - `type YoutrustStatus = "draft"|"ongoing"|"done"|"declined"|"expired"|"canceled"|"approval"|"rejected"|"deleted"`
  - `class YoutrustError extends Error { status: number }`
  - `createYoutrustClient({ apiKey, staging }, fetchImpl = fetch): YoutrustClient` where
    ```ts
    interface YoutrustClient {
      createRequest(input: { name: string; signers: YoutrustSigner[]; pdf: Uint8Array; fileName: string; externalId: string }): Promise<{ requestId: string; documentId: string }>;
      getStatus(requestId: string): Promise<{ status: YoutrustStatus; signers: { email: string; status: string }[] }>;
      cancel(requestId: string, reason: string): Promise<void>;
      downloadSigned(requestId: string): Promise<Uint8Array>;
      downloadAuditTrail(requestId: string): Promise<Uint8Array>;
    }
    ```
    `createRequest` runs the documented sequence: create the request (`ordered_signers: true`, `delivery_mode: "email"`, `external_id`), upload the PDF as a `signable_document`, add each signer (`signature_level: "electronic_signature"`, `signature_authentication_mode: "otp_email"`, one signature field on the last page), then activate. If any step after create fails, it deletes or cancels the draft before rethrowing.

- [ ] **Step 1: Write failing tests** with a recording fake `fetch`:
  - `createRequest` calls create → upload → signer ×2 → activate in that order, against `https://api-sandbox.yousign.app/v3` when `staging` is true, with `Authorization: Bearer <key>`, and returns the IDs;
  - signers are added with `order` 0 and then 1;
  - a 4xx on activate triggers a cleanup call and rejects with a `YoutrustError` whose `status` is the 4xx;
  - `getStatus` maps the response to `{ status, signers }`;
  - settings round-trip: `encryptSignatureCredentials` then `loadSignatureSettings` on a memory client returns the same key, and `hasApiKey` is true.
- [ ] **Step 2: Run `pnpm test`.** Expected: the new tests FAIL (the module is not found).
- [ ] **Step 3: Implement both files.** Confirm the endpoints and field names against the current API reference first (see Global Constraints). Place the signature field with a fixed position on the last page unless the reference confirms smart anchors, in which case use the anchor `{{s1|signature|180|60}}`-style tag and document it in `SignatureSettings` help text.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): Youtrust client and settings`).

### Task 3: Webhook verification and status mapping

**Files:**
- Create: `apps/admin/server/signatures/webhook.ts`
- Test: `tests/youtrust-webhook.test.mjs` (pure functions here; the endpoint is tested in Task 7)

**Interfaces:**
- Produces:
  - `verifyWebhook(rawBody: string, header: string | undefined, secret: string): boolean`. HMAC-SHA256 of the raw body with the secret, compared to the header using `timingSafeEqual`, with the construction confirmed in the docs (expected `sha256=<hex>`). It returns false for a missing header or a length mismatch.
  - `type RequestStatus = "draft"|"sending"|"sent"|"signed_by_person"|"completed"|"declined"|"expired"|"cancelled"|"error"`
  - `statusFromEvent(event: { event_name: string; data: unknown }, personEmail: string): RequestStatus | null`. `signature_request.done` → `completed`; `.declined` → `declined`; `.expired` → `expired`; `.canceled` → `cancelled`; `.activated` → `sent`; `signer.done` for the person's email → `signed_by_person`; anything else → `null`.
  - `statusFromYoutrust(s: YoutrustStatus, signers, personEmail): RequestStatus`, used by Refresh with the same rules.
  - `canMoveTo(from: RequestStatus, to: RequestStatus): boolean`. Terminal states (`completed`, `declined`, `expired`, `cancelled`) never change. `signed_by_person` never goes back to `sent`.

- [ ] **Step 1: Write failing tests.** A body signed with the secret verifies. One changed byte fails. A missing header fails. Each event name maps as above. `canMoveTo("completed","sent") === false` and `canMoveTo("sent","signed_by_person") === true`.
- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): webhook verification and status rules`).

### Task 4: Template filling

**Files:**
- Create: `apps/admin/server/signatures/fields.ts`, `apps/admin/server/signatures/google-docs.ts`
- Test: `tests/signature-fields.test.mjs`

**Interfaces:**
- Consumes: `driveApi(sa, path, opts)` and `DriveSettings` from `server/documents/storage/google-drive.ts`.
- Produces (`fields.ts`):
  - `extractFields(text: string): string[]`: unique field names in order of first appearance.
  - `type PersonFacts = { fullName: string; email: string; role: string; contractType: string | null; salaryMonthly: number | null; dailyRate: number | null; startDate: string | null; probationEnd: string | null; matricule: string | null }`
  - `knownValues(facts: PersonFacts, today: string, signatoryName: string): Record<string, string>` with keys `prenom`, `nom` (the rest after the first space), `nom_complet`, `email`, `poste`, `type_contrat`, `salaire_brut_mensuel`, `tjm`, `date_debut`, `fin_periode_essai`, `matricule`, `date_du_jour`, `signataire_quicksort`. A missing fact gives `""`.
  - `missingFields(fields: string[], values: Record<string, string>): string[]`: the fields whose trimmed value is empty.
  - `loadPersonFacts(client: SupabaseClient, personId: string): Promise<PersonFacts>`. It reads `hr_people`, the open `employees` row (or the latest), the `employee_salaries` row covering today (salary and `daily_rate`), and `offers.contract_type` by `employees.offer_id`.
- Produces (`google-docs.ts`):
  - `class DocAccessError extends Error`, with the message `Share this Google Doc with ${serviceAccountEmail} (Viewer is enough).`
  - `readDocText(sa, docId): Promise<string>`: Docs API `GET documents/{id}`, joining every `textRun.content`.
  - `fillTemplate(sa, { templateDocId, folderId, name, values }): Promise<{ docCopyId: string; pdf: Uint8Array }>`. It copies with Drive `files/{id}/copy` into `folderId`, applies Docs `batchUpdate` with one `replaceAllText` per value (`{{name}}`, `matchCase: true`), re-reads the text, calls `assertNoPlaceholders`, and exports with Drive `files/{id}/export?mimeType=application/pdf`.
  - `assertNoPlaceholders(text: string): void` throws `Error("These fields were not filled: a, b")`, listing the names still found.
  - A 403 or 404 from Google on the template becomes a `DocAccessError`.

- [ ] **Step 1: Write failing tests:**
  - `extractFields("Bonjour {{prenom}}, {{ nom }} {{prenom}}")` deep-equals `["prenom","nom"]`;
  - `knownValues` formats `salaryMonthly: 3500` as `"3 500,00 €"` (compare after replacing narrow and non-breaking spaces with a space) and `startDate: "2026-12-01"` as `"01/12/2026"`, and splits `"Jean Paul Martin"` into `prenom: "Jean"`, `nom: "Paul Martin"`;
  - `missingFields(["prenom","salaire_brut_mensuel"], { prenom: "Jean", salaire_brut_mensuel: " " })` deep-equals `["salaire_brut_mensuel"]`;
  - `assertNoPlaceholders("ok {{tjm}}")` throws `/tjm/`;
  - with a fake `driveApi` and `fetch`: a 404 on the copy rejects with a `DocAccessError` whose message contains the service account email; the happy path calls copy, then batchUpdate, then export.
- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** The Docs API is called with the same service-account token as `driveApi`. Add a `docsApi` sibling in `google-docs.ts` that uses `https://docs.googleapis.com/v1/`. The existing `drive` scope is accepted by the Docs API.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): fill Google Docs templates`).

### Task 5: Server-side filing into the registry

**Files:**
- Modify: `apps/admin/server/documents/storage/types.ts` (add `uploadFile` to `DocumentStorage`)
- Modify: `apps/admin/server/documents/storage/google-drive.ts` (implement it with `uploadFileContent`)
- Modify: `apps/admin/server/documents/handler.ts` (export `resolveFolder`, `loadType` and `defaultStorage`; no behaviour change)
- Create: `apps/admin/server/documents/file.ts`
- Test: `tests/document-file.test.mjs`

**Interfaces:**
- Produces:
  - `DocumentStorage.uploadFile(folder: StorageFolder, file: { name: string; mimeType: string }, bytes: Uint8Array): Promise<StoredFile>`
  - `fileBuffer(client: SupabaseClient, storage: DocumentStorage, input: { personId: string; typeCode: string; title: string; fileName: string; bytes: Uint8Array; signatureRequestId: string; supersedes?: string | null; parentDocumentId?: string | null; issuedOn?: string | null }): Promise<{ id: string }>`. It resolves the type's folder for `{ kind: "person", id }` and uploads, then calls the RPC `register_signed_document`. If that fails it trashes the uploaded file. On `23505` (the same `provider_file_id`) it returns the existing row, as `registerFile` does.
  - `personFolder(client, storage, personId, typeCode): Promise<StorageFolder>`: a thin wrapper over `loadType` + `resolveFolder`, also used by Task 6 for the preview copy.

- [ ] **Step 1: Write failing tests** with a fake storage and a memory client: `fileBuffer` uploads into the folder for `contrat_travail`, calls `register_signed_document` with `signature_request` set and `document.person_id` set, and returns the ID. When the RPC errors with `P0001`, `storage.trash` is called once with the uploaded file ID.
- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS, including `documents-api.test.mjs` and `document-storage.test.mjs`. Fakes there that implement `DocumentStorage` need an `uploadFile` stub.
- [ ] **Step 5: Commit** (`feat(documents): file server-generated PDFs`).

### Task 6: Admin API

**Files:**
- Create: `apps/admin/api/signatures.ts`
- Modify: `apps/admin/vite.config.ts` (add `'/api/signatures': '/api/signatures.ts'`)
- Test: `tests/signatures-api.test.mjs` (copy the `memoryClient` helper from `tests/invoicing-api.test.mjs`)

**Interfaces:**
- Consumes: Tasks 2, 4 and 5.
- Produces: `createSignaturesHandler(deps = { createClient, createYoutrust: youtrustFromSettings, docs: { readDocText, fillTemplate }, storage: defaultStorage, now })` and `export default createSignaturesHandler()`. Auth works like `api/invoicing.ts` (Clerk token → `workspace_user_id` → `user_roles.role === "admin"`, otherwise 403 `"Admin access is required."`). POST `{ action }`:

| action | input | result |
|---|---|---|
| `get-settings` | — | `SignatureSettings` + `serviceAccountEmail` + `webhookUrl` (`${origin}/api/youtrust-webhook`) |
| `save-settings` | `staging, signatoryName, signatoryEmail, apiKey?, webhookSecret?` | settings (absent secrets are kept) |
| `list-templates` | — | templates |
| `save-template` | `id?, name, googleDocUrl, signers, typeCode, active` | the template. Parses the Doc ID from the URL and runs `readDocText` (a `DocAccessError` becomes a 400 with its message). Returns `fields`. |
| `list-requests` | `personId` | that person's requests, newest first |
| `prepare` | `personId, templateId` | `{ fields: { name, value, known: boolean }[], signers }` built from `extractFields(readDocText)` + `knownValues(loadPersonFacts)` |
| `preview` | `personId, templateId, values, signers, supersedes?` **or** `personId, title, typeCode, pdfBase64, signers, supersedes?` | inserts a `draft` request. For a template: refuses if `missingFields` is non-empty (400 `"Fill in: …"`), calls `fillTemplate` into `personFolder(...)`, then uploads the PDF with `storage.uploadFile`. For a custom PDF: checks the `%PDF-` header and ≤ 10 MB, then uploads. Stores `doc_copy_file_id`, `pdf_file_id`, `pdf_folder_id`. Returns `{ request, previewUrl }`, where `previewUrl` goes through the existing documents download, or returns `pdfBase64`. |
| `send` | `requestId` | conditional update `draft → sending` (0 rows → 409 `"Already sent."`). Downloads `pdf_file_id` from storage, calls `createRequest` with `externalId = requestId`, then stores the IDs with status `sent`. On failure: status `error` with a message, 502. |
| `refresh` | `requestId` | `getStatus` → `statusFromYoutrust` → apply if `canMoveTo`. If `completed` and not yet filed, run the same `completeRequest` as the webhook (Task 7). |
| `cancel` | `requestId` | Youtrust `cancel` (when sent) → `cancelled`. A draft is cancelled locally. |
| `discard-draft` | `requestId` | trash the draft's files and delete the draft row |

Signers are built server-side from the template's `signers` + the person's email/name (editable in `preview`) + the settings signatory. The order: person 0, Quicksort 1.

- [ ] **Step 1: Write failing tests:**
  - a non-admin role → 403 for every action;
  - `save-template` with a Doc the fake `readDocText` rejects with a `DocAccessError` → 400 whose body contains the service account email;
  - `prepare` returns `salaire_brut_mensuel` as known and filled, plus an unknown `clause_speciale` with `known: false` and `""`;
  - `preview` with one empty value → 400 `/Fill in: clause_speciale/`, and no `fillTemplate` call;
  - `preview` for a custom upload that isn't a PDF → 400;
  - `send` twice on the same draft → the first returns 200 and the fake Youtrust `createRequest` is called **once**, the second returns 409;
  - `send` when `createRequest` throws → the request has status `error` and the response is 502;
  - the signer order for `person_and_quicksort` is `[person(order 0), signatory(order 1)]`, and for `quicksort` only the signatory;
  - `get-settings` never includes `apiKey` or `webhookSecret` values.
- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Put `completeRequest` in `server/signatures/complete.ts` (signature in Task 7) so Refresh and the webhook share it.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): admin API`).

### Task 7: Webhook endpoint and completion

**Files:**
- Create: `apps/admin/server/signatures/complete.ts`, `apps/admin/api/youtrust-webhook.ts`
- Modify: `apps/admin/vite.config.ts` (add the route), `apps/admin/.env.example` (document that `SUPABASE_SERVICE_ROLE_KEY` is also used by the webhook)
- Test: `tests/youtrust-webhook-api.test.mjs`

**Interfaces:**
- Produces:
  - `completeRequest(client: SupabaseClient, youtrust: YoutrustClient, storage: DocumentStorage, request: SignatureRequestRow): Promise<void>`. If `signed_document_id` is null, it downloads the signed PDF and files it with `fileBuffer` (the request's `type_code`, `title`, `supersedes`, `issuedOn` = today). If `audit_document_id` is null, it downloads the audit trail and files it as `OTHER` with `parentDocumentId` = the signed document. It sets each ID right after its filing, so a retry skips the parts already done, then sets the status to `completed`.
  - `createYoutrustWebhookHandler(deps = { createClient, createYoutrust, storage })`, with `export default`. It reads the **raw** body from the request stream (never `req.body`), loads settings with the service-role client, and returns 401 if `verifyWebhook` fails. It inserts `event_id` into `signature_webhook_events`; a conflict returns 200 `{ duplicate: true }`. It finds the request by `data.signature_request.id`; an unknown ID returns 200 `{ ignored: true }`. It applies `statusFromEvent` when `canMoveTo` allows. On `completed` it awaits `completeRequest`; if that throws, it deletes the event row (so Youtrust's retry runs again) and returns 500.
  - Set `export const config = { maxDuration: 60 }`.

- [ ] **Step 1: Write failing tests** with a memory service-role client, a fake Youtrust and a fake storage:
  - a bad signature → 401 and no writes;
  - `signer.done` for the person → status `signed_by_person`;
  - `signature_request.done` → two `fileBuffer` uploads (contract, then audit trail with `parent_document_id`), status `completed`;
  - **the same `done` event delivered twice → one signed document** (Review Focus 1);
  - a `done` event for an unknown request ID → 200, nothing written (Review Focus 2);
  - `done` when the audit trail download fails → 500, the event row is removed, `signed_document_id` is set; a second delivery files only the audit trail;
  - `done` after `cancelled` → status stays `cancelled`.
- [ ] **Step 2: Run `pnpm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): Youtrust webhook and filing`).

### Task 8: Admin screens

**Files:**
- Create: `apps/admin/src/signatures/client.ts`, `apps/admin/src/signatures/SignatureSettings.tsx`, `apps/admin/src/signatures/PersonSignatures.tsx`
- Modify: `apps/admin/src/SettingsPage.tsx` (`SettingsSection` gains `"signatures"`, rendered for admins), `apps/admin/src/App.tsx` (the Settings tab "Signatures", next to "Google Drive contracts"), `apps/admin/src/hr/PersonWorkspace.tsx` (an `EmpSection title="Contracts & signatures"` after "Documents", shown only for admins)
- Test: `tests/signatures.spec.ts` (Playwright, using the harness in the `admin-visual-harness` memory: route swap, no sign-in; `/api/signatures` mocked with `page.route`)

**Interfaces:**
- Consumes: the Task 6 actions.
- Produces: `postSignatures<T>(action: { action: string } & Record<string, unknown>): Promise<T>`, using the same Clerk-token fetch as `GoogleDriveSettings.tsx`.

**Behaviour:**
- **Settings → Signatures:**
  - a Youtrust card with sandbox/production, API key and webhook secret (write-only inputs that show "Saved" when set), the signatory name and email, and the read-only webhook URL to paste into Youtrust;
  - a Templates card with a list (name, signers, document type, active) and an add/edit form. It shows the service account email with "Share each template Doc with this address", and the fields found after saving.
- **Person page section:**
  - a table of requests: title, sent date, status badge (`sent` "Sent", `signed_by_person` "Signed by person", `completed` "Signed", `declined`, `expired`, `cancelled`, `error`), and actions (Refresh, Cancel, open the signed document);
  - a "Send for signature" button opens a panel:
    1. step 1: a template select, or "Custom PDF" (file input, `accept="application/pdf"`, 10 MB check);
    2. step 2: the field values form, where known values are prefilled and unknown ones are empty and required; signer name and email; and "Replaces" (a select of the person's active documents of the template's type, default "Nothing");
    3. step 3: "Build preview" shows the PDF in an `<object type="application/pdf">`;
    4. step 4: "Send for signature". "Discard" calls `discard-draft`.
  - The send button is disabled while any value is empty or a request is in flight.

- [ ] **Step 1: Write failing Playwright tests** with a mocked API:
  - the settings tab shows the webhook URL and the service account email;
  - in the person section, the "Send" button stays disabled until the empty `clause_speciale` field is filled;
  - after "Build preview", the `<object>` is visible;
  - a `completed` row shows "Signed".
- [ ] **Step 2: Run `pnpm test:browser tests/signatures.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** with `@quicksort-sas/ui` components and the existing `SettingsCard`/`EmpSection` patterns. Colours, background and typography come from the existing tokens; don't restyle anything else.
- [ ] **Step 4: Run it again, then `pnpm typecheck`.** Expected: PASS. Screenshot both screens at about 1155px wide, per the `admin-visual-harness` memory.
- [ ] **Step 5: Commit** (`feat(signatures): settings and person page screens`).

### Task 9: Portal clean-up for employees

**Files:**
- Modify: `apps/admin/src/portal/HrPortal.tsx`
- Test: `tests/portal.spec.ts` (extend)

- [ ] **Step 1: Check the old tables.** Run `select count(*) from contracts` and `select count(*) from contract_signatures` on the linked database (via `supabase` CLI or the dashboard). Report the counts to Mohamed in the task summary; don't delete anything.
- [ ] **Step 2: Write failing tests in `portal.spec.ts`.** For a user with an open employment: `/contracts` shows the page-not-found state, the "My onboarding" page has no "Waiting for your signature" card, and the sidebar has no "My contracts". For a candidate without employment: "My contracts" is still in the sidebar.
- [ ] **Step 3: Run it.** Expected: FAIL. Today's code only hides the sidebar entry; the route and card remain.
- [ ] **Step 4: Implement.** When `onboardingOpen`, `routes` excludes `contracts` as well as `application`; `visibleNav` goes back to `routes`; render `tab === "contracts"` only when `!onboardingOpen`; and remove the "Waiting for your signature" card and the "To sign" stat. Delete `unsigned`/`openReview` usages only if they become unused.
- [ ] **Step 5: Run `pnpm test:browser tests/portal.spec.ts` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(portal): employees no longer see in-app contract signing`).

---

## After the last task

- Set up in Youtrust **sandbox**: create a webhook subscription to `https://<admin domain>/api/youtrust-webhook` for `signature_request.*` and `signer.done`, then copy its secret into Settings → Signatures.
- End to end in the sandbox: send a test CDI to Mohamed's own address, sign it, and check the PDF and the audit trail appear in the test person's Documents and in the portal.
