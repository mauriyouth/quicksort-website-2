# Freelancer Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the invoices freelancers send us (by portal upload or email to a configured mailbox), check them against CRA × TJM, mark them paid from Qonto debits, list them on Sales → Freelancer invoices, and feed real costs to the business plan.

**Architecture:**
- **Pure TypeScript modules** in `apps/admin/server/freelancer-invoices/` do the calculations and matching: CRA check, status, payment matching, field normalization. Each is unit-tested with `node --test`.
- **Thin adapters** wrap the external services: Gmail (service-account JWT with domain-wide delegation), Kimi extraction (same pattern as `kimi-profile.ts`), and Drive (the existing `DocumentStorage`).
- **One API handler,** `api/freelancer-invoices.ts`, serves admin and portal actions. One cron runs the mail poll and payment matching.
- **Supabase tables** are admin-only under RLS. Freelancers read their own invoices through a `security definer` RPC.

**Tech Stack:** TypeScript, React + `@quicksort-sas/ui`, Supabase Postgres (RLS, RPC), Vercel functions + cron, Kimi (Moonshot) structured output, Gmail API, Google Drive, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-freelancer-invoices-design.md`

## Global Constraints

- **Scope:** only freelancers, meaning `employees.contract_type = 'Freelance'`. Never other suppliers.
- **Gmail reading:**
  - the scope is `https://www.googleapis.com/auth/gmail.readonly` and nothing more;
  - list only messages `from:` a known freelancer address, `has:attachment filename:pdf`;
  - never fetch the bodies of other messages.
- **Mailbox:** the address is a setting, `mohamed@quicksort.fr` initially, never hard-coded in code paths.
- **First email run:** `after:2026/01/01`.
- **CRA check:**
  - **Expected amount:** Σ CRA client-project days (full = 1, am/pm = 0.5) × the `daily_rate` in effect *on each day*.
  - **Compared with:** Σ non-rejected invoices HT for the freelancer and month, with credit notes negative.
  - **Match:** `|diff| < 1` €.
- **Payment matching:**
  - It uses the invoice TTC against `bank_transactions.amount_cents` (Qonto debits are negative, so compare absolute values), settled on or after the invoice date.
  - **Confident match:** exactly one candidate, exact amount, and the counterparty matches by IBAN or name.
  - Everything else is a **probable** match and needs a human.
  - Each debit pays at most one invoice, unless an admin explicitly links it to several.
- **Due date:** the date on the PDF, otherwise invoice date + 30 days.
- **Duplicates:** the same `employee_id` + invoice number, or the same file sha256.
- **New document type:** `FREELANCE_INVOICE`. The PDF goes in the freelancer's people folder in Drive.
- **Access:**
  - Admin only (`private.is_admin()`) for every new table.
  - The portal shows a freelancer only their own invoices with the status received / to pay / paid, never review notes or mismatch details.
- **Money:** amounts are stored in cents (`bigint`), like `bank_transactions`.
- **Naming:** the UI copy is in English, like the rest of the admin. Error messages returned by APIs follow the file they sit in (bank cron = French).

## Review Focus

1. **One debit covering two months of invoices** (amount = sum of two TTCs). It must stay unpaid and be offered as a *probable* match, never auto-marked. This is tested in Task 3.
2. **A freelancer with the same TJM every month,** so identical TTC amounts repeat, during the backfill from January. Each invoice must match only a debit dated on or after its own invoice date, and when two candidates remain the match is probable. This is tested in Task 3.
3. **A forwarded or reply email from a freelancer containing an old invoice PDF already stored.** The sha256 dedupe must link it and not create a second invoice. This is tested in Task 5.
4. **An extraction returning no period month or no amount** (scanned image PDF, no text). The invoice must be created as *To check*, never dropped, and must be excluded from the business plan until fixed. This is tested in Tasks 4, 5 and 9.
5. **A freelancer uploading through the portal a file for another person's employee id.** The API must derive the employee from the caller's linked person and ignore any id in the body. This is tested in Task 7.

---

## File Structure

```
supabase/migrations/20261230090000_freelancer_invoices.sql    tables, RLS, RPCs, document type
tests/freelancer-invoices.sql                                  DB checks (wired into scripts/verify-hr-database.mjs)
apps/admin/server/freelancer-invoices/
  types.ts        shared row/domain types
  check.ts        expectedCraCents, monthCheck, displayStatus, dueDate
  match.ts        matchPayments
  extract.ts      Kimi extraction + toInvoiceFields normalizer
  intake.ts       ingestInvoicePdf (dedupe → store → extract → insert → billing prefill)
  store.ts        Supabase-backed FreelancerInvoiceStore
  gmail.ts        gmailToken, buildQuery, listMessageIds, getMessagePdfs
  poll.ts         pollMailbox
  run.ts          runFreelancerInvoicesCycle (poll + match), wired from settings
apps/admin/api/freelancer-invoices.ts       admin + portal actions
apps/admin/api/freelancer-invoices-cron.ts  cron entry (GET, CRON_SECRET)
apps/admin/src/sales/freelancer-invoices/
  FreelancerInvoices.tsx  page
  InvoiceDetail.tsx       row detail panel
  MailboxSettings.tsx     mailbox + Gmail delegation setup
  api.ts                  useFreelancerInvoicesApi (pattern of sales/invoicing/api.ts)
apps/admin/src/portal/MyInvoices.tsx         portal section
apps/admin/src/ops/business-plan/actuals.ts  (modify) real invoice cost
tests/freelancer-invoices-check.test.mjs
tests/freelancer-invoices-match.test.mjs
tests/freelancer-invoices-extract.test.mjs
tests/freelancer-invoices-intake.test.mjs
tests/freelancer-invoices-gmail.test.mjs
tests/freelancer-invoices-api.test.mjs
tests/freelancer-invoices.spec.ts
tests/portal.spec.ts                        (modify)
tests/business-plan-model.test.mjs          (modify)
```

---

### Task 1: Database schema, RLS and RPCs

**Files:**
- Create: `supabase/migrations/20261230090000_freelancer_invoices.sql`
- Create: `tests/freelancer-invoices.sql`
- Modify: `scripts/verify-hr-database.mjs` (run the new SQL file after `project-consumption.sql`)
- Modify: `packages/hr-db/src/database.types.ts` (add the new tables and RPCs)

**Interfaces:**
- **Produces:** the tables and RPCs listed below. All later tasks use these names.

The tables are:
- `public.freelancer_billing`:
  - `employee_id uuid pk references employees`
  - `company_name text not null default ''`, `siret text not null default ''`, `iban text not null default ''` (stored uppercase without spaces)
  - `extra_emails text[] not null default '{}'`
  - `updated_by text`, `updated_at timestamptz`
- `public.freelancer_invoices`:
  - `id uuid pk`, `employee_id uuid not null`
  - `source text check in ('portal','email')`
  - `gmail_message_id text`
  - `document_id uuid references documents`
  - `sha256 text not null`
  - `number text not null default ''`
  - `issue_date date`, `period_month date` (first of month, check `extract(day)=1`), `due_date date`
  - `amount_ht_cents bigint`, `vat_cents bigint`, `amount_ttc_cents bigint`
  - `is_credit_note boolean not null default false`
  - `review text not null default 'to_check' check in ('to_check','ok','rejected')`
  - `flags text[] not null default '{}'`: why an invoice can't be auto-approved (`not_invoice`, `unreadable`, `iban_changed`)
  - `review_note text not null default ''`
  - `extraction jsonb`
  - `paid_at timestamptz`, `paid_by_transaction_id text references bank_transactions(id)`
  - `created_at`, `updated_at`, `version int`
  - unique `(employee_id, sha256)`
  - unique `(employee_id, number) where number <> ''`
- `public.freelancer_invoice_matches`:
  - `invoice_id`, `transaction_id`
  - `kind text check in ('confident','probable','manual')`
  - `state text check in ('suggested','confirmed','dismissed')`
  - `created_at`, `decided_by`
  - pk `(invoice_id, transaction_id)`
- `public.freelancer_invoice_events`, in the style of `invoice_events`: `invoice_id`, `kind`, `actor_email`, `detail jsonb`, `created_at`.
- `public.freelancer_mailbox_settings`:
  - singleton id `'mailbox'`
  - `address text not null default 'mohamed@quicksort.fr'`
  - `backfill_from date not null default '2026-01-01'`
  - `last_polled_at timestamptz`, `last_error text`, `locked_until timestamptz`

Seed `document_types` with `'FREELANCE_INVOICE','Freelance invoice'`, owner `{person}`, applicable to `{Freelance}`, not required, with the same column order as the `RIB` row in `20261122090000_documents.sql:47`.

The RPCs are:
- `public.my_freelancer_invoices()` returns a table with `id`, `number`, `period_month`, `amount_ttc_cents`, `received_at`, `portal_status` (`'received'|'to_pay'|'paid'`).
  - It is `security definer` and limited to the employee rows linked to `auth.uid()` through `hr_person_accounts`.
  - `portal_status` is `'paid'` when `paid_at` is set, `'to_pay'` when `review = 'ok'`, otherwise `'received'`.
- `public.freelancer_known_senders()` returns `(employee_id uuid, email text)`, lowercased and distinct: `hr_people.email` plus `freelancer_billing.extra_emails`, for active Freelance employees. Service role only.

- [ ] **Step 1: Write the failing SQL test** `tests/freelancer-invoices.sql`, using the fixture style of `tests/invoicing.sql`: an admin, one freelancer employee (`contract_type='Freelance'`) linked to a portal user, and a second employee linked to a second user. Assert with `pg_temp.assert_true`:
  - as the admin: an insert into `freelancer_invoices` succeeds;
  - as the freelancer: a `select` from `freelancer_invoices` returns 0 rows, and `my_freelancer_invoices()` returns exactly their 1 invoice with `portal_status='received'`;
  - as the second user: `my_freelancer_invoices()` returns 0 rows;
  - a second insert with the same `(employee_id, sha256)` raises a unique violation;
  - `freelancer_known_senders()` includes a lowercased extra email added to `freelancer_billing`.
- [ ] **Step 2: Run** `pnpm test:hr-db`. Expected: FAIL (`relation "public.freelancer_invoices" does not exist`).
- [ ] **Step 3: Write the migration** with the tables and RPCs above, and the RLS `for all to authenticated using ((select private.is_admin())) with check (...)` on every table, copied from `20261119090000_client_invoicing.sql:102-107`.
- [ ] **Step 4: Run** `pnpm test:hr-db`. Expected: it prints the existing pass lines plus `Freelancer invoice checks passed`.
- [ ] **Step 5: Regenerate or extend the types** in `packages/hr-db/src/database.types.ts` and run `pnpm typecheck`. Expected: exit 0.
- [ ] **Step 6: Commit** with `git commit -m "feat(freelancer-invoices): schema, RLS and portal RPC"`.

---

### Task 2: CRA check and status (pure)

**Files:**
- Create: `apps/admin/server/freelancer-invoices/types.ts`, `apps/admin/server/freelancer-invoices/check.ts`
- Test: `tests/freelancer-invoices-check.test.mjs`

**Interfaces:**
- **Produces, in `types.ts`:**
  - `FreelancerInvoice = { id: string; employeeId: string; number: string; issueDate: string | null; periodMonth: string | null; dueDate: string | null; amountHtCents: number | null; vatCents: number | null; amountTtcCents: number | null; isCreditNote: boolean; flags: string[]; review: "to_check" | "ok" | "rejected"; reviewNote: string; paidAt: string | null; paidByTransactionId: string | null; source: "portal" | "email"; createdAt: string }`
  - `CraDay = { day: string; part: "full" | "am" | "pm"; status: string; projectId: string | null }`
  - `RateRow = { dailyRate: number | null; startDate: string; endDate: string | null; rateKind: "daily" | "monthly" }`
- **Produces, in `check.ts`:**
  - `expectedCraCents(days: CraDay[], rates: RateRow[]): { days: number; cents: number; missingRate: boolean }`. It counts only `status === "client_project"`.
  - `monthCheck(invoices: FreelancerInvoice[], expected: { cents: number; days: number } | null): { invoicedHtCents: number; expectedCents: number | null; diffCents: number | null; ok: boolean; reason: "match" | "mismatch" | "no_cra" | "unreadable" }`
  - `displayStatus(inv: FreelancerInvoice, monthOk: boolean): { status: "to_check" | "to_pay" | "paid" | "rejected"; warning: boolean; overdue: boolean }`. It takes `today` through a third parameter `today: string`.
  - `dueDate(issueDate: string | null, printedDue: string | null): string | null`

- [ ] **Step 1: Write the failing tests:**
  - `expectedCraCents`:
    - 12 full days + 2 `am` at a €700 rate gives `{ days: 13, cents: 910000 }`;
    - a rate change from €650 to €700 on the 15th prices each day at its own rate;
    - `internal` and `paid_leave` days are ignored;
    - no daily rate gives `missingRate: true`.
  - `monthCheck`:
    - invoices of €8,400.00 and €8,400.50 against expected 840000 give `ok: true` (diff 50 < 100);
    - €9,100 against €8,450 gives `ok: false, reason: "mismatch", diffCents: 65000`;
    - two invoices of €5,000 and €3,400 against €8,400 give `ok: true`;
    - a credit note of −€400 plus €8,800 gives `ok: true`;
    - rejected invoices are excluded;
    - `expected === null` gives `reason: "no_cra"`;
    - any non-rejected invoice with `amountHtCents === null` gives `reason: "unreadable", ok: false`.
  - `displayStatus`:
    - `paidAt` set with `monthOk: false` gives `{ status: "paid", warning: true }`;
    - `review: "ok"`, unpaid, with due date `2026-10-01` and today `2026-11-11` gives `{ status: "to_pay", overdue: true }`;
    - `review: "to_check"` gives `to_check`;
    - `review: "rejected"` gives `rejected`.
  - `dueDate`: `("2026-10-31", null)` gives `"2026-11-30"`, and `("2026-10-31", "2026-11-15")` gives `"2026-11-15"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-check.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `check.ts`. Work in integer cents: day weight × rate × 100, rounded per day.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): CRA check and status rules"`.

---

### Task 3: Payment matching (pure)

**Files:**
- Create: `apps/admin/server/freelancer-invoices/match.ts`
- Test: `tests/freelancer-invoices-match.test.mjs`

**Interfaces:**
- **Consumes:** `FreelancerInvoice` (Task 2).
- **Produces:**
  - `Debit = { id: string; settledAt: string; amountCents: number; counterparty: string; iban: string | null }`. The amount is negative for debits.
  - `Billing = { employeeId: string; personName: string; companyName: string; iban: string }`
  - `Existing = { invoiceId: string; transactionId: string; state: "suggested" | "confirmed" | "dismissed" }`
  - `matchPayments(invoices: FreelancerInvoice[], debits: Debit[], billing: Billing[], existing: Existing[]): { confident: { invoiceId: string; transactionId: string }[]; probable: { invoiceId: string; transactionId: string; why: "name_fuzzy" | "amount_differs" | "ambiguous" }[] }`
  - `debitIban(raw: unknown): string | null` reads the beneficiary IBAN from the Qonto payload. Check `raw.transfer?.counterparty_account_number` and `raw.transfer?.counterparty_iban`, then normalize to uppercase with no spaces.
  - `nameMatches(counterparty: string, candidates: string[]): "exact" | "fuzzy" | "none"`. It case-folds, strips accents and legal suffixes (SAS, SASU, SARL, EURL, EI), and collapses spaces. Exact means equal after normalization; fuzzy means one contains the other or all name tokens are present.
  - Rules: see Global Constraints.
    - Skip invoices that are rejected or already paid.
    - Skip pairs whose `existing` state is `dismissed`.
    - Skip debits that already have a `confirmed` match.

- [ ] **Step 1: Write the failing tests:**
  - **IBAN match:** a €8,400 TTC invoice dated 2026-10-31 and a debit of −840000 on 2026-11-08 with the same IBAN give a confident match.
  - **Company name:** with an empty IBAN in billing, counterparty "ACME CONSULTING SASU" and company "Acme Consulting" give a confident match.
  - **Fuzzy name:** counterparty "K. Benali" and person "Karim Benali" give a probable match `name_fuzzy`.
  - **Too early:** a debit dated before the invoice date gives no candidate.
  - **Repeated amounts (Review Focus 2):** two invoices of €8,400 for Sep and Oct, and two debits of −840000 on 2026-10-07 and 2026-11-08 with matching IBAN, give a confident match for Oct → Nov-08 only and a probable `ambiguous` match for Sep, because both debits are on or after its date.
  - **One debit for two months (Review Focus 1):** a debit of −1680000 with matching IBAN against two €8,400 invoices gives no confident match and one probable `amount_differs` match for each invoice.
  - **Dismissed:** a dismissed pair is never proposed again.
  - **Already confirmed:** a debit confirmed for another invoice is not reused.
  - **`debitIban`:** `{ transfer: { counterparty_account_number: "fr76 3000 1234" } }` gives `"FR7630001234"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-match.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `match.ts`. Process invoices newest-first by issue date. A debit used by a confident match leaves the pool before older invoices are evaluated. The "amount_differs" rule applies when the IBAN or name is exact, the debit amount ≠ TTC, and there is no exact-amount candidate.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): match invoices to Qonto debits"`.

---

### Task 4: PDF field extraction

**Files:**
- Create: `apps/admin/server/freelancer-invoices/extract.ts`
- Test: `tests/freelancer-invoices-extract.test.mjs`

**Interfaces:**
- **Consumes:**
  - `extractPdfText(pdf: Uint8Array, maxChars: number)` from `apps/admin/server/cv-text.ts`;
  - the Kimi call pattern from `apps/admin/server/kimi-profile.ts`: `ENDPOINT`, `thinking: disabled`, a strict `json_schema`, one retry, `KimiError`.
- **Produces:**
  - `InvoiceFields = { number: string; issueDate: string | null; dueDate: string | null; periodMonth: string | null; amountHtCents: number | null; vatCents: number | null; amountTtcCents: number | null; isCreditNote: boolean; issuerName: string; issuerSiret: string; issuerIban: string; looksLikeInvoice: boolean }`
  - `toInvoiceFields(raw: unknown): InvoiceFields`. This normalizer:
    - turns euros into cents;
    - converts DD/MM/YYYY dates to ISO;
    - sets `periodMonth` to the first of the month, deriving it from a "période"/"mois de" mention, else from the issue date's previous month when the issue date is on days 1–10, else null;
    - computes TTC as HT + VAT when TTC is missing;
    - sets `vatCents` to 0 when "TVA non applicable, art. 293 B" appears;
    - normalizes the IBAN to uppercase with no spaces;
    - sets `isCreditNote` true for "avoir" and makes the amounts negative.
  - `extractInvoice(cfg: { apiKey: string; model: string }, pdf: Uint8Array, deadline: number, fetchImpl?: typeof fetch): Promise<InvoiceFields>`.
    - It never throws on unreadable content: empty text returns all nulls with `looksLikeInvoice: false`.
    - It throws `KimiError` only on HTTP failure.

- [ ] **Step 1: Write the failing tests** for `toInvoiceFields`:
  - `{ total_ht: 8400, total_vat: 1680, total_ttc: 10080, issue_date: "31/10/2026", period: "octobre 2026" }` gives `amountTtcCents: 1008000`, `periodMonth: "2026-10-01"`;
  - an issue date of `2026-11-03` with no period gives `periodMonth: "2026-10-01"`;
  - an issue date of `2026-10-20` with no period gives `null`;
  - a VAT exemption mention gives `vatCents: 0, amountTtcCents === amountHtCents`;
  - `document_kind: "avoir"` gives negative cents.

  For `extractInvoice`:
  - with a mocked `fetch` returning a fenced JSON answer, it parses;
  - with HTTP 500, it throws `KimiError`;
  - with an empty-text PDF fixture, it returns `looksLikeInvoice: false` without calling fetch.

  Put the fixtures in `tests/fixtures/freelancer-invoice.pdf` (a minimal text PDF) and `tests/fixtures/empty.pdf`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-extract.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `extract.ts`. The system prompt asks for French invoice fields: numéro, date, échéance, période, HT, TVA, TTC, émetteur, SIRET, IBAN and avoir. Transcribe, never invent.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): extract invoice fields from PDF"`.

---

### Task 5: Intake service

**Files:**
- Create: `apps/admin/server/freelancer-invoices/intake.ts`, `apps/admin/server/freelancer-invoices/store.ts`
- Test: `tests/freelancer-invoices-intake.test.mjs`

**Interfaces:**
- **Consumes:** `extractInvoice` (Task 4), `dueDate` (Task 2), `DocumentStorage.uploadFile` / `ensureFolder` (`server/documents/storage/types.ts`), and the people-folder resolution used in `server/documents/folders.ts`.
- **Produces:**
  - `FreelancerInvoiceStore`, an interface implemented by `createSupabaseFreelancerInvoiceStore(client)` in `store.ts`:
    - `findDuplicate(employeeId: string, sha256: string, number: string): Promise<string | null>`
    - `insertInvoice(row: NewInvoiceRow): Promise<string>`
    - `registerDocument(input: { personId: string; fileId: string; folderId: string; fileName: string; sha256: string; size: number; issuedOn: string | null }): Promise<string>`, which calls the existing `register_document` RPC with `type_code: 'FREELANCE_INVOICE'`
    - `billing(employeeId: string): Promise<Billing | null>`
    - `prefillBilling(employeeId: string, patch: { companyName?: string; siret?: string; iban?: string }): Promise<void>`, which only fills empty fields
    - `logEvent(invoiceId: string, kind: string, actorEmail: string, detail: unknown): Promise<void>`
    - `personFor(employeeId: string): Promise<{ personId: string; fullName: string }>`
  - `ingestInvoicePdf(deps: { store: FreelancerInvoiceStore; storage: DocumentStorage; extract: (pdf: Uint8Array) => Promise<InvoiceFields>; now: () => Date }, input: { employeeId: string; bytes: Uint8Array; fileName: string; source: "portal" | "email"; gmailMessageId?: string; actorEmail: string }): Promise<{ invoiceId: string; duplicate: boolean }>`
    - It computes the sha256.
    - It checks for a duplicate by hash first. If one exists, it logs a `duplicate_received` event on the existing invoice and returns `duplicate: true`.
    - Otherwise it extracts, then checks for a duplicate by number. If one exists, it does the same as for a hash duplicate.
    - Otherwise it uploads to the Drive people folder and registers the document.
    - It always inserts the invoice with `review: 'to_check'`, and sets `flags`: `not_invoice` when `!looksLikeInvoice`, `unreadable` when `amountHtCents` or `periodMonth` is null, and `iban_changed` when the issuer IBAN differs from the stored billing IBAN. The cycle in Task 6 moves the invoice to `'ok'` only when `flags` is empty and the month check passes.
    - It prefills billing from the issuer fields and logs a `received` event.

- [ ] **Step 1: Write the failing tests** with an in-memory store and a fake storage (pattern: `tests/bank-sync.test.mjs` `memoryStore`):
  - **New PDF:** one upload, one invoice, one `received` event, and the billing prefilled with the IBAN.
  - **Same bytes again (Review Focus 3):** `duplicate: true`, no second upload, a `duplicate_received` event.
  - **Different bytes, same number:** `duplicate: true`.
  - **Extraction with `periodMonth: null` (Review Focus 4):** the invoice is inserted with `review: 'to_check'`, `periodMonth: null` and `flags: ['unreadable']`.
  - **Existing billing IBAN differs from the issuer IBAN:** `review: 'to_check'` and `flags` contains `iban_changed`. The billing IBAN is not overwritten.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-intake.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `intake.ts` and `store.ts`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): ingest PDFs with dedupe and Drive filing"`.

---

### Task 6: Gmail poll and the cycle (poll + check + match)

**Files:**
- Create: `apps/admin/server/freelancer-invoices/gmail.ts`, `apps/admin/server/freelancer-invoices/poll.ts`, `apps/admin/server/freelancer-invoices/run.ts`
- Test: `tests/freelancer-invoices-gmail.test.mjs`

**Interfaces:**
- **Consumes:**
  - `ServiceAccount`, and the JWT signing in `driveToken` from `server/documents/storage/google-drive.ts:82`. Factor the signing into `signServiceAccountJwt(sa, claims)` exported from that file, and keep `driveToken` behaving the same.
  - `ingestInvoicePdf` (Task 5), `matchPayments` / `debitIban` (Task 3), `monthCheck` / `expectedCraCents` (Task 2).
- **Produces:**
  - `gmailToken(sa: ServiceAccount, mailbox: string, fetchImpl?: typeof fetch): Promise<string>`. The JWT claims are `{ iss, sub: mailbox, scope: GMAIL_SCOPE, aud, iat, exp }`, with `export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"`.
  - `buildQuery(senders: string[], after: string): string`. For example, `buildQuery(["a@x.fr","b@y.fr"], "2026-01-01")` returns `'from:(a@x.fr OR b@y.fr) has:attachment filename:pdf after:2026/01/01'`.
  - `listMessageIds(token: string, mailbox: string, query: string, fetchImpl?): Promise<string[]>` handles `nextPageToken` paging.
  - `getMessagePdfs(token: string, mailbox: string, id: string, fetchImpl?): Promise<{ from: string; pdfs: { fileName: string; bytes: Uint8Array }[] }>`. It reads only `payload.headers[From]` and the parts with `mimeType === "application/pdf"` or a `.pdf` filename. Attachments are fetched via `attachments/{attachmentId}`.
  - `pollMailbox(deps: { senders: { employeeId: string; email: string }[]; mailbox: string; after: string; seenMessageIds: Set<string>; gmail: { list; get }; ingest: typeof ingestInvoicePdf-bound }): Promise<{ messages: number; invoices: number; duplicates: number; skipped: number }>`
    - It skips message ids already in `seenMessageIds`.
    - It maps the sender to an employee by the lowercased bare address.
    - It ingests each PDF with `source: "email"`.
  - `runFreelancerInvoicesCycle(client: SupabaseClient, deps: { fetch?: typeof fetch; now?: () => Date }): Promise<{ poll: PollResult | { skipped: string }; matched: number; suggested: number; reviewed: number }>`. It:
    - loads the mailbox settings and Drive settings (`loadDriveSettings`), plus the AI settings;
    - takes the `locked_until` lock;
    - polls from `max(backfill_from, last_polled_at - 2 days)`;
    - then for every month touched, sets `review = 'ok'` on `to_check` invoices with empty `flags` whose month check passes;
    - then runs `matchPayments` over the unpaid invoices and the debits since `backfill_from`;
    - sets `paid_at` and `paid_by_transaction_id` for confident matches, and upserts suggested rows for probable ones;
    - logs events and releases the lock.
    - When Drive or Gmail isn't configured, the poll returns `{ skipped: "<reason>" }` and matching still runs.

- [ ] **Step 1: Write the failing tests:**
  - `buildQuery`, as shown above.
  - `gmailToken` posts a JWT whose decoded claims have `sub === "mohamed@quicksort.fr"` and the readonly scope, using a mocked fetch.
  - `getMessagePdfs` with a mocked message holding one PDF, one PNG and an inline HTML body returns exactly one PDF and never requests the PNG attachment.
  - `pollMailbox`:
    - a seen id is skipped;
    - the sender `"Karim <KARIM@ex.fr>"` maps to Karim's employee;
    - an unknown sender is skipped (defensive, since the query already filters);
    - two PDFs on one message give two ingest calls.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-gmail.test.mjs tests/google-drive.test.mjs`. Expected: the new file FAILs and `google-drive.test.mjs` still passes.
- [ ] **Step 3: Implement** `gmail.ts`, `poll.ts` and `run.ts`, plus the `signServiceAccountJwt` refactor.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): poll mailbox and run matching cycle"`.

---

### Task 7: API handler and cron

**Files:**
- Create: `apps/admin/api/freelancer-invoices.ts`, `apps/admin/api/freelancer-invoices-cron.ts`
- Modify: `apps/admin/vercel.json` (add a cron `{ "path": "/api/freelancer-invoices-cron", "schedule": "0 * * * *" }`)
- Modify: `apps/admin/api/bank-transactions-cron.ts` (after `syncWithSettings`, call the matching part of `runFreelancerInvoicesCycle` with `{ pollMail: false }`; a failure there must not fail the bank response)
- Test: `tests/freelancer-invoices-api.test.mjs`

**Interfaces:**
- **Consumes:** `runFreelancerInvoicesCycle` (Task 6), `ingestInvoicePdf` (Task 5), `monthCheck` / `displayStatus` (Task 2). It follows the handler shape and the `HttpError` pattern of `api/bank-transactions.ts`, and the cron auth of `api/bank-transactions-cron.ts`.
- **Produces:** `createFreelancerInvoicesHandler(deps)` and `createFreelancerInvoicesCronHandler(deps)`.
  - `GET ?resource=month&month=YYYY-MM-01` (admin) returns `{ rows: MonthRow[] }`.
    - `MonthRow = { employeeId; name; expected: { days; cents } | null; check: ReturnType<typeof monthCheck>; invoices: (FreelancerInvoice & { display: ReturnType<typeof displayStatus>; suggestions: { transactionId; amountCents; settledAt; counterparty; why }[] })[]; missing: boolean }`
    - `missing` is true when there are expected days > 0 and no non-rejected invoice.
  - `GET ?resource=settings` (admin) returns `{ mailbox, backfillFrom, lastPolledAt, lastError, driveServiceAccountEmail }`.
  - `GET ?resource=pdf&id=` (admin) returns `{ url }` through the documents download path.
  - `POST` actions (admin, zod discriminated union):
    - `update_fields`: `{ id, version, fields: Partial<InvoiceFields> }`; it clears `unreadable` once amount and period are set
    - `accept_difference`: `{ id, note }`, where `note` is 3–500 chars; it sets `review='ok'`
    - `reject`: `{ id, note }`
    - `confirm_match`: `{ invoiceId, transactionId }`. It sets paid and saves the debit's counterparty name and IBAN into `freelancer_billing` when empty.
    - `dismiss_match`: `{ invoiceId, transactionId }`
    - `link_debit`: `{ invoiceIds: string[], transactionId }`, a manual link to several invoices
    - `unlink`: `{ invoiceId }`
    - `save_billing`: `{ employeeId, companyName, siret, iban, extraEmails }`
    - `save_mailbox`: `{ address, backfillFrom }`
    - `sync`
  - `POST portal_upload` (any signed-in user):
    - The body is `{ fileName, data: base64 }`, with a 3 MB cap like `MAX_EXTRACT_BYTES` and PDF only.
    - **The employee is derived server-side** from `hr_person_accounts` → active Freelance employment of the caller. Any `employeeId` in the body is ignored (Review Focus 5).
    - No Freelance employment → 403.
- **Cron:** `GET` with `Bearer CRON_SECRET` runs `runFreelancerInvoicesCycle`.

- [ ] **Step 1: Write the failing tests** (pattern: `tests/bank-transactions-api.test.mjs`, a mocked `createClient`):
  - a non-admin `GET month` returns 403;
  - an admin `GET month` builds rows with `missing: true` for a freelancer with CRA and no invoice;
  - `accept_difference` with a 2-char note returns 400;
  - `confirm_match` sets paid and prefills the billing IBAN from the transaction raw;
  - `portal_upload` with a body `employeeId` of another employee still ingests under the caller's own employee;
  - `portal_upload` from a CDI employee returns 403;
  - a non-PDF returns 400;
  - the cron without a secret returns 401.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/freelancer-invoices-api.test.mjs tests/bank-transactions-api.test.mjs`. Expected: the new file FAILs.
- [ ] **Step 3: Implement** both handlers, the bank-cron hook and the `vercel.json` cron.
- [ ] **Step 4: Run** `pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): admin, portal and cron API"`.

---

### Task 8: Admin page (Sales → Freelancer invoices)

**Files:**
- Create: `apps/admin/src/sales/freelancer-invoices/FreelancerInvoices.tsx`, `InvoiceDetail.tsx`, `MailboxSettings.tsx`, `api.ts`
- Modify:
  - `apps/admin/src/App.tsx`: in the nav under Sales after Invoicing, add `{ id: "sales-freelancer-invoices", href: "/sales/freelancer-invoices", label: "Freelancer invoices" }`; add the id to `salesTabIds`; add a route `<Route path="/sales/freelancer-invoices/*" element={<FreelancerInvoices />} />`, admin only like Invoicing.
- Test: `tests/freelancer-invoices.spec.ts`

**Interfaces:**
- **Consumes:** the Task 7 API, and `useInvoicingApi`-style auth (copy the pattern in `src/sales/invoicing/api.ts`) as `useFreelancerInvoicesApi()`.
- **Produces:** the page, as in mockup option A of the spec:
  - **Header:** a month picker that defaults to the previous month.
  - **Tabs:** All / To check / To pay / Paid / Missing, with counts. A paid invoice with a warning appears under both Paid and To check.
  - **Table columns:** Freelancer, Invoice, Amount (HT / TTC), CRA check (`✓ 12 d × €700` or `⚠ CRA says €8,450 (13 d × €650)`), Received (`email · 2 Nov` / `portal · 3 Nov`), Status (`Paid 8 Nov` / `To pay · due 4 Dec`, red when overdue / `To check` / `Missing`).
  - **Detail panel:**
    - the PDF link;
    - editable fields (`update_fields`);
    - the CRA breakdown;
    - suggestions with Confirm / Dismiss;
    - "Accept difference" with a note, and Reject with a note;
    - the billing details editor;
    - the event history.
  - **Settings:** the mailbox address, the backfill date, the last poll and error, and a "Sync now" button. Setup text explains the domain-wide delegation step: add the service-account client ID with the scope `https://www.googleapis.com/auth/gmail.readonly` in Google Workspace Admin → Security → API controls.

- [ ] **Step 1: Write the failing Playwright spec** with the route-swap harness (see `tests/hr-workspace.spec.ts` / `tests/signatures.spec.ts`), mocking `/api/freelancer-invoices` with 4 rows (paid, mismatch, to-pay overdue, missing). Assert:
  - the tab counts `To check (1)`, `To pay (1)`, `Paid (1)`, `Missing (1)`;
  - the mismatch row text contains `CRA says €8,450`;
  - clicking Confirm on a suggestion POSTs `confirm_match` with both ids;
  - "Accept difference" is disabled until the note has 3 characters;
  - there is no horizontal scroll at a 1155px viewport.
- [ ] **Step 2: Run** `pnpm test:browser tests/freelancer-invoices.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the page with `@quicksort-sas/ui` components already used in `src/sales/invoicing/Invoicing.tsx`.
- [ ] **Step 4: Run the same command, then `pnpm typecheck`.** Expected: PASS, exit 0.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): admin page under Sales"`.

---

### Task 9: Portal section and business plan

**Files:**
- Create: `apps/admin/src/portal/MyInvoices.tsx`
- Modify: `apps/admin/src/portal/HrPortal.tsx`
  - add `{ id: "invoices", href: "/invoices", label: "My invoices", icon: Receipt }` to `nav`;
  - show it only when the person has a non-ended employment with `contract_type === "Freelance"`. `employmentSchema` must carry `contract_type`, so extend the select feeding it.
- Modify: `apps/admin/src/ops/business-plan/actuals.ts`
  - add `freelancerInvoices?: { employee_id: string; period_month: string | null; amount_ht_cents: number | null; review: string }[]` to `PlanSources`;
  - add the loader `loadFreelancerInvoices(client, year)`;
  - in the freelance loop:
    - invoiced cost = Σ non-rejected invoices with a non-null period and amount for that month, over **every** freelancer with invoices that month (staffed or not);
    - the estimate is used only for staffed freelancers with no such invoice;
    - extend `FreelanceLine` with `source: "invoice" | "cra" | "estimate"` and `invoicedCents?: number`;
    - update the header comment's "Freelance cost" convention.
- Modify: `apps/admin/src/ops/business-plan/DetailPanel.tsx` to show "Invoiced", "CRA" or "Estimate" per line.
- Test: `tests/business-plan-model.test.mjs`, `tests/portal.spec.ts`

**Interfaces:**
- **Consumes:** `my_freelancer_invoices()` (Task 1) and `portal_upload` (Task 7).
- **Produces:** the portal list (number, month, amount TTC, received date, status chip Received / To pay / Paid) and the upload button. The upload message is "Invoice sent. We'll check it against your CRA."

- [ ] **Step 1: Write the failing tests.**

  In `business-plan-model.test.mjs`, for `aggregateActuals`:
  - a freelancer with an invoice of 900000 cents HT for October and CRA of 12 d × €700 gives October cost 9000 € and line `source: "invoice"`;
  - the same freelancer with no invoice gives 8400 € and `source: "cra"`;
  - an unstaffed freelancer with a 50000-cent expenses invoice in October is included;
  - a `rejected` invoice is ignored;
  - an invoice with `period_month: null` is ignored (Review Focus 4).

  In `portal.spec.ts`:
  - a Freelance employee sees "My invoices" with 2 mocked rows and their statuses, and an upload POSTs `portal_upload` without an `employeeId`;
  - a CDI employee does not see the tab.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/business-plan-model.test.mjs` and `pnpm test:browser tests/portal.spec.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the portal section, the `actuals.ts` change and the `DetailPanel` label, and wire `loadFreelancerInvoices` where the other loaders are called in `BusinessPlan.tsx`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm test:browser tests/portal.spec.ts tests/freelancer-invoices.spec.ts` and `pnpm typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(freelancer-invoices): portal upload and real cost in business plan"`.

---

### Task 10: Setup docs and end-to-end check

**Files:**
- Modify: `apps/admin/.env.example` (no new env vars are expected; it relies on the existing `CRON_SECRET` and the Drive service account. Add a comment pointing to the setup.)
- Create: `docs/freelancer-invoices.md` (how intake works, the Gmail delegation steps, statuses, and the matching rules from Global Constraints)

- [ ] **Step 1:** Write `docs/freelancer-invoices.md`.
- [ ] **Step 2:** Run the full suite: `pnpm test && pnpm test:hr-db && pnpm test:browser && pnpm typecheck`. Expected: all green, with the output pasted in the PR.
- [ ] **Step 3: Commit** with `git commit -m "docs(freelancer-invoices): setup and rules"`.
