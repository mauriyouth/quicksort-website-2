# Client Invoicing via Qonto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins generate monthly per-consultant draft invoices from the CRA, validate and send them through Qonto, and follow every project's invoices and payment status in the admin app.

**Architecture:** Our own invoice tables in Supabase (admin-only RLS) are the app's model; a server-side `InvoicingProvider` interface hides Qonto behind `apps/admin/server/invoicing/qonto.ts`. A single Vercel function `apps/admin/api/invoicing.ts` authenticates the admin, talks to the provider and writes our tables. Pure modules compute draft lines from CRA entries and reconcile provider invoices; React screens live in `apps/admin/src/sales/invoicing/`.

**Tech Stack:** TypeScript, React 18, Supabase/Postgres (plpgsql), Vercel functions, zod, `node --test` (strip-types), Qonto Business API v2.

**Spec:** `docs/superpowers/specs/2026-10-28-client-invoicing-qonto-design.md`

## Global Constraints

- Régie projects only (`pricing_model='regie'`); forfait is ignored everywhere.
- One invoice per consultant × project × calendar month; never two non-canceled CRA invoices for the same triple.
- Billed client = `sales_projects.intermediary_client_id` when set, else `client_id`.
- VAT: the linked product's `vat_rate`, default `"0.2"`.
- Only admins (`user_roles.role='admin'` / `private.is_admin()`) can read or change any invoicing data or call any invoicing endpoint.
- The Qonto secret never reaches the browser; it is stored AES-256-GCM-encrypted with `AI_SETTINGS_ENCRYPTION_KEY` and AAD `quicksort/invoicing/v1`.
- No Qonto-specific field names outside `apps/admin/server/invoicing/qonto.ts`.
- Qonto base URLs: production `https://thirdparty.qonto.com`, sandbox `https://thirdparty-sandbox.staging.qonto.co` (+ header `X-Qonto-Staging-Token`). Auth header: `Authorization: <login>:<secret_key>` (just `<secret_key>` when login is empty).
- Go-live: `invoicing_settings.start_month`; months before it are never offered for invoicing.
- Due date = issue date + `options.due_days` (default 30). Issue date = today (Europe/Paris) at draft creation.
- UI copy is English, like the rest of the admin app. Invoice line text is French (see Task 3).
- Work on branch `feat/client-invoicing` **in the current working tree** (untracked migrations such as `20261118090000_project_intermediary_client.sql` are prerequisites). Stage only the files each task names — the tree has unrelated uncommitted work.
- Tests: `pnpm test` (root, runs `tests/*.test.mjs`), `pnpm test:hr-db` (Docker Postgres), `pnpm --filter @quicksort/admin typecheck`.

## Review Focus

1. Qonto product titles are up to 120 chars but invoice item titles max 40 → title is truncated to 40 chars (test in Task 3).
2. A day split am=project / pm=other activity counts 0.5; a day full on the project counts 1 (test in Task 3).
3. Double "Create draft" (double click, two admins) → the second call returns the existing invoice and makes no second provider `createDraft` call (test in Task 6).
4. Qonto 4xx error bodies (`errors[].detail`) surface as a readable message and never echo the secret (test in Task 2).
5. Qonto client with no `email` and no `extra_emails` → send is refused with "This client has no invoice email in Qonto." and no provider call (test in Task 6).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261119090000_client_invoicing.sql` | Tables, RLS, CRA lock in `cra_save_month`, `invoiced` flag in `cra_month_snapshot` |
| `tests/invoicing.sql` | DB assertions (RLS, unique triple, CRA lock) |
| `apps/admin/server/invoicing/provider.ts` | Provider-agnostic types + interface |
| `apps/admin/server/invoicing/qonto.ts` | Qonto adapter |
| `apps/admin/server/invoicing/draft.ts` | Pure: CRA → draft lines, rate periods, totals |
| `apps/admin/server/invoicing/month.ts` | Pure: "To invoice" rows with blockers/warnings |
| `apps/admin/server/invoicing/sync.ts` | Pure: reconcile provider invoices, auto-link project |
| `apps/admin/server/invoicing/settings.ts` | Load/save encrypted provider settings, build provider |
| `apps/admin/server/ai-settings.ts` | Generalize encryption to `encryptSecret/decryptSecret(value, aad)` |
| `apps/admin/api/invoicing.ts` | HTTP handler (GET resources, POST actions) |
| `apps/admin/src/sales/invoicing/*` | Invoicing page, draft panel, settings, project section, client API |
| `apps/admin/src/App.tsx`, `src/sales/Projects.tsx`, `src/cra/*` | Nav/route, project section mount, CRA lock UI |
| `tests/invoicing-*.test.mjs` | Unit/handler tests |

---

### Task 1: Database schema, RLS and CRA lock

**Files:**
- Create: `supabase/migrations/20261119090000_client_invoicing.sql`
- Create: `tests/invoicing.sql`
- Modify: `scripts/verify-hr-database.mjs` (run `tests/invoicing.sql` right after `tests/cra.sql`)

**Interfaces:**
- Produces tables (all `enable row level security`, one policy `for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))`, `revoke all ... from anon`):
  - `invoicing_settings(id text pk default 'default' check (id='default'), provider text not null default 'qonto', encrypted_credentials text, options jsonb not null default '{}', start_month date check (start_month is null or extract(day from start_month)=1), last_synced_at timestamptz, updated_by uuid references profiles, updated_at timestamptz default now())`. `options` keys: `login`, `iban`, `staging` (bool), `due_days` (int).
  - `invoicing_client_links(client_id uuid pk references sales_clients on delete cascade, provider text not null, provider_client_id text not null, provider_client_name text not null default '', linked_by uuid, linked_at timestamptz default now(), unique(provider, provider_client_id))`
  - `invoicing_product_links(project_id uuid references sales_projects on delete cascade, pricing_line text not null, provider text not null, provider_product_id text not null, title text not null, description text not null default '', unit text not null default 'jour', vat_rate numeric not null default 0.2, primary key(project_id, pricing_line))`
  - `invoices(id uuid pk default gen_random_uuid(), provider text not null, provider_invoice_id text, number text, status text not null check (status in ('draft','finalized','paid','canceled')), source text not null check (source in ('cra','imported')), project_id uuid references sales_projects on delete set null, billed_client_id uuid references sales_clients on delete set null, provider_client_id text, employee_id uuid references employees, period_month date check (period_month is null or extract(day from period_month)=1), cra_version integer, issue_date date, due_date date, paid_at timestamptz, finalized_at timestamptz, sent_at timestamptz, currency char(3) not null default 'EUR', total_ht numeric not null default 0, total_vat numeric not null default 0, total_ttc numeric not null default 0, purchase_order text not null default '', invoice_url text, ignored boolean not null default false, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(), unique(provider, provider_invoice_id), check (source<>'cra' or (project_id is not null and employee_id is not null and period_month is not null)))`
  - `create unique index invoices_one_per_consultant_month on invoices(project_id, employee_id, period_month) where source='cra' and status<>'canceled';`
  - `invoice_lines(id uuid pk, invoice_id uuid not null references invoices on delete cascade, position int not null, title text not null, description text not null default '', quantity numeric not null, unit text not null, unit_price numeric not null, vat_rate numeric not null, pricing_line text not null default '', computed_quantity numeric, computed_unit_price numeric)`
  - `invoice_events(id uuid pk, invoice_id uuid not null references invoices on delete cascade, kind text not null, actor uuid, detail jsonb not null default '{}', created_at timestamptz default now())`
- Modifies `public.cra_save_month` (copy the body from `20261027090000_cra_half_days.sql`, add after the access check):
  `if not (private.is_admin() or private.hr_operator()) and private.cra_invoiced(target_employee,target_month) then raise exception 'This CRA month has been invoiced and is locked. Ask an admin to change it.'; end if;`
- Produces `private.cra_invoiced(employee uuid, month date) returns boolean` (security definer, `search_path=''`): exists invoice with that employee + period_month and status in `('finalized','paid')`.
- Modifies `public.cra_month_snapshot` to add `'invoiced', private.cra_invoiced(target_employee,target_month)`.
- Ends with `notify pgrst, 'reload schema';`

- [ ] **Step 1: Write `tests/invoicing.sql`** in the style of `tests/cra.sql` (begin; fixtures; `pg_temp.assert_true`; rollback). Fixtures: admin, HR user, employee account linked to an employee, a régie project assigned to the employee. Assertions:
  - as `authenticated` employee: `select count(*) from public.invoices` = 0 rows visible after an admin inserted one; insert into `invoices` fails.
  - second insert of a `source='cra'` non-canceled invoice for the same (project, employee, 2026-11-01) fails with unique violation; it succeeds once the first is `canceled`.
  - with a `finalized` invoice for (employee, 2026-11-01): employee `cra_save_month` fails with message containing `invoiced and is locked`; admin and HR saves succeed; `cra_month_snapshot(...)->>'invoiced'` = `'true'`.
  - with only a `draft` invoice: employee save succeeds.
- [ ] **Step 2: Run** `pnpm test:hr-db` — Expected: FAIL (relation `public.invoices` does not exist).
- [ ] **Step 3: Write the migration** per Interfaces.
- [ ] **Step 4: Run** `pnpm test:hr-db` — Expected: all checks pass, including the new invoicing file and the existing `tests/cra.sql`.
- [ ] **Step 5: Commit** `git add supabase/migrations/20261119090000_client_invoicing.sql tests/invoicing.sql scripts/verify-hr-database.mjs && git commit -m "feat(invoicing): invoice tables, admin RLS and CRA lock"`

---

### Task 2: Provider interface and Qonto adapter

**Files:**
- Create: `apps/admin/server/invoicing/provider.ts`, `apps/admin/server/invoicing/qonto.ts`
- Test: `tests/invoicing-qonto.test.mjs`

**Interfaces (Produces):**
```ts
// provider.ts
export type InvoiceStatus = "draft" | "finalized" | "paid" | "canceled";
export type ProviderClient = { id: string; name: string; emails: string[]; vatNumber: string | null; taxId: string | null; currency: string };
export type ProviderProduct = { id: string; title: string; description: string; unit: string | null; unitPrice: string | null; vatRate: string };
export type PaymentAccount = { iban: string; name: string };
export type DraftLine = { title: string; description: string; quantity: string; unit: string; unitPrice: string; vatRate: string };
export type InvoiceDraft = { clientId: string; issueDate: string; dueDate: string; currency: string; periodStart: string; periodEnd: string; purchaseOrder: string; lines: DraftLine[] };
export type ProviderInvoice = { id: string; number: string | null; status: InvoiceStatus; clientId: string | null; clientEmails: string[]; issueDate: string | null; dueDate: string | null; periodStart: string | null; periodEnd: string | null; currency: string; totalHt: string; totalVat: string; totalTtc: string; paidAt: string | null; finalizedAt: string | null; invoiceUrl: string | null; purchaseOrder: string; lines: DraftLine[] };
export class ProviderError extends Error { status: number }
export interface InvoicingProvider {
  readonly name: string;                       // "qonto"
  listPaymentAccounts(): Promise<PaymentAccount[]>; // also the connection test
  listClients(): Promise<ProviderClient[]>;
  listProducts(): Promise<ProviderProduct[]>;
  listInvoices(): Promise<ProviderInvoice[]>;  // all statuses, imported included
  getInvoice(id: string): Promise<ProviderInvoice>;
  createDraft(draft: InvoiceDraft): Promise<ProviderInvoice>;
  updateDraft(id: string, draft: InvoiceDraft): Promise<ProviderInvoice>;
  deleteDraft(id: string): Promise<void>;
  finalize(id: string): Promise<ProviderInvoice>;
  send(id: string, message: { to: string[]; subject: string; body: string }): Promise<void>;
  cancel(id: string): Promise<ProviderInvoice>;
}
// qonto.ts
export type QontoConfig = { login: string; secretKey: string; iban: string; stagingToken?: string };
export function createQontoProvider(config: QontoConfig, fetchImpl?: typeof fetch): InvoicingProvider;
```
Qonto mapping:
- `listPaymentAccounts` → `GET /v2/organization`, map `organization.bank_accounts[]` `{iban, name}`.
- `listClients` → `GET /v2/clients?per_page=100&page=n` until `meta.next_page` is null; `emails` = `[email, ...extra_emails]` without blanks/duplicates; `taxId` = `tax_identification_number`.
- `listProducts` → `GET /v2/products` (same paging); `vatRate` = `vat_rate`.
- `listInvoices` → `GET /v2/client_invoices?exclude_imported=false&per_page=100&page=n`. Status `unpaid`→`finalized`; others map 1:1. `totalTtc`=`total_amount.value`, `totalVat`=`vat_amount.value`, `totalHt` = TTC − VAT computed in cents. `clientEmails` from `client.email` + `client.extra_emails`.
- `createDraft` → `POST /v2/client_invoices` body `{ status:"draft", client_id, issue_date, due_date, currency, performance_start_date, performance_end_date, purchase_order (omit when ""), payment_methods:{iban}, items:[{title, description, quantity, unit, unit_price:{value,currency}, vat_rate}] }`; response `client_invoice`.
- `updateDraft` → `PATCH /v2/client_invoices/{id}` with the same body minus `status`.
- `deleteDraft` → `DELETE /v2/client_invoices/{id}`; `finalize` → `POST .../{id}/finalize`; `cancel` → `POST .../{id}/mark_as_canceled`; `send` → `POST .../{id}/send` body `{send_to, email_title, email_body, copy_to_self:true}`.
- Non-2xx → `throw new ProviderError(details joined by "; " or "Qonto request failed (<status>).", status)`. Message never contains the secret.

- [ ] **Step 1: Write failing tests** with a recording fake `fetch` (returns queued `Response`s):
  - `createDraft sends draft payload with iban and auth header`: asserts URL `https://thirdparty.qonto.com/v2/client_invoices`, method POST, header `authorization` = `"acme-1234:sk"`, body `status==="draft"`, `items[0].unit_price` deep-equals `{value:"650.00",currency:"EUR"}`, `payment_methods` deep-equals `{iban:"FR76..."}`, `purchase_order` absent when `""`.
  - `staging config uses sandbox url and staging header`.
  - `listClients follows pagination and merges extra emails`: two pages; result length 3; `emails` deep-equals `["a@x.fr","b@x.fr"]` for a client with `email:"a@x.fr", extra_emails:["b@x.fr","a@x.fr"]`.
  - `listInvoices maps unpaid to finalized and computes HT`: `total_amount.value "1200.00"`, `vat_amount.value "200.00"` → `totalHt === "1000.00"`, `status === "finalized"`.
  - `422 surfaces detail without secret`: response `{errors:[{detail:"due_date must be after issue_date"}]}` → rejects with `ProviderError` whose message is `"due_date must be after issue_date"`, status 422, and `!message.includes("sk")`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/invoicing-qonto.test.mjs` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `provider.ts` and `qonto.ts` per Interfaces.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/admin/server/invoicing/provider.ts apps/admin/server/invoicing/qonto.ts tests/invoicing-qonto.test.mjs && git commit -m "feat(invoicing): provider interface and Qonto adapter"`

---

### Task 3: Draft builder (CRA → invoice lines)

**Files:**
- Create: `apps/admin/server/invoicing/draft.ts`
- Test: `tests/invoicing-draft.test.mjs`

**Interfaces:**
- Consumes: `storedPricingLines` from `apps/admin/src/sales/pricing-lines.ts`; `DraftLine`, `InvoiceDraft` from Task 2.
- Produces:
```ts
export type CraEntry = { day: string; part: "full" | "am" | "pm"; status: string; project_id: string | null };
export type AssignmentRef = { project_id: string; employee_id: string; pricing_line: string; start_date: string; end_date: string | null; status: string };
export type ProjectRef = { id: string; tjm_profiles: unknown; currency: string };
export type ExtensionRef = { start_date: string | null; status: string; tjm_profiles: unknown };
export type ProductRef = { title: string; description: string; unit: string; vat_rate: number };
export type BuiltLine = DraftLine & { pricingLine: string; computedQuantity: number; computedUnitPrice: number };
export type DraftResult = { ok: true; lines: BuiltLine[]; totals: { ht: string; vat: string; ttc: string } } | { ok: false; blocker: "no_days" | "no_pricing_line" | "no_rate" | "product_not_linked"; pricingLine?: string };
export function projectDayAmounts(entries: CraEntry[], projectId: string): { day: string; amount: number }[];
export function resolvePricingLine(assignment: AssignmentRef, project: ProjectRef): string | null;
export function rateOn(day: string, pricingLine: string, project: ProjectRef, extensions: ExtensionRef[]): number | null;
export function buildDraftLines(input: { month: string; consultantName: string; projectId: string; entries: CraEntry[]; assignments: AssignmentRef[]; project: ProjectRef; extensions: ExtensionRef[]; products: Record<string, ProductRef> }): DraftResult;
export function draftTotals(lines: DraftLine[]): { ht: string; vat: string; ttc: string };
export function monthPeriod(month: string): { start: string; end: string };
export function addDays(isoDate: string, days: number): string;
```
Rules:
- `projectDayAmounts`: `client_project` entries for `projectId`; `full`=1, `am`/`pm`=0.5, summed per day.
- `resolvePricingLine`: `assignment.pricing_line` if non-empty; else the single line name when the project has exactly one line; else `null`.
- `rateOn`: the line named `pricingLine` in the latest `status='signed'` extension with `start_date <= day` that contains that name; otherwise the project's own line; `null` if none.
- `buildDraftLines`: each day is attributed to the assignment of that employee+project covering it (statuses `confirmed|active|completed`); group days by (pricingLine, rate) in date order → one line per group. `quantity` = sum with up to 1 decimal as string (`"17.5"`, `"18"`); `unitPrice` = rate with 2 decimals; `unit` = product unit; `vatRate` = `String(product.vat_rate)`; `title` = product title truncated to 40 chars; `description` = `${product.description}\n` (omitted if empty) + `Consultant : ${consultantName} — ${monthLabelFr}` where `monthLabelFr` is `"octobre 2026"` (`toLocaleDateString("fr-FR",{month:"long",year:"numeric"})`); when a pricing line has more than one group, append ` (du DD/MM au DD/MM)` with the group's first/last day.
- `draftTotals`: integer cents; line HT = round(quantity × unitPrice × 100); VAT per line = round(HT × vatRate); sums formatted with 2 decimals.

- [ ] **Step 1: Write failing tests**:
  - `half days count 0.5`: entries 2026-11-02 full, 2026-11-03 am project + pm internal → `projectDayAmounts` deep-equals `[{day:"2026-11-02",amount:1},{day:"2026-11-03",amount:0.5}]`.
  - `single line from CRA`: 18 full days, line "Data Engineer" 650, product `{title:"Prestation de conseil", description:"Assistance technique", unit:"jour", vat_rate:0.2}`, consultant "Jane Doe", month "2026-11" → one line `{title:"Prestation de conseil", quantity:"18", unitPrice:"650.00", unit:"jour", vatRate:"0.2", description:"Assistance technique\nConsultant : Jane Doe — novembre 2026"}`; totals `{ht:"11700.00", vat:"2340.00", ttc:"14040.00"}`.
  - `title truncated to 40 chars`: product title of 60 chars → `lines[0].title.length === 40`.
  - `extension mid-month splits rate`: signed extension starting 2026-11-16 with "Data Engineer" 700 → two lines, unit prices `"650.00"` and `"700.00"`, descriptions end with `(du 02/11 au 13/11)` and `(du 16/11 au 30/11)`.
  - `blocked without pricing line`: assignment `pricing_line:""` and project with two lines → `{ok:false, blocker:"no_pricing_line"}`.
  - `blocked without product`: products `{}` → `{ok:false, blocker:"product_not_linked", pricingLine:"Data Engineer"}`.
  - `no days`: entries for another project only → `{ok:false, blocker:"no_days"}`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/invoicing-draft.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `draft.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/admin/server/invoicing/draft.ts tests/invoicing-draft.test.mjs && git commit -m "feat(invoicing): build draft lines from CRA"`

---

### Task 4: "To invoice" rows and sync/auto-link

**Files:**
- Create: `apps/admin/server/invoicing/month.ts`, `apps/admin/server/invoicing/sync.ts`
- Test: `tests/invoicing-month.test.mjs`, `tests/invoicing-sync.test.mjs`

**Interfaces:**
- Consumes: Task 3 types/functions; `frenchHolidays` from `apps/admin/src/cra/domain.ts`; `ProviderInvoice` (Task 2).
- Produces:
```ts
// month.ts
export type InvoiceRowRef = { id: string; project_id: string | null; employee_id: string | null; period_month: string | null; status: InvoiceStatus; source: "cra" | "imported"; cra_version: number | null; total_ht: number; number: string | null };
export type ToInvoiceRow = { projectId: string; projectTitle: string; employeeId: string; consultantName: string; billedClientId: string; billedClientName: string; days: number; amountHt: string | null; status: "not_invoiced" | InvoiceStatus; invoiceId: string | null; craChanged: boolean; blockers: ("client_not_linked" | "no_pricing_line" | "no_rate" | "product_not_linked")[]; warnings: ("cra_incomplete")[] };
export function missingWorkingDays(month: string, entries: CraEntry[], employment: { start_date: string; end_date: string | null }): string[];
export function toInvoiceRows(input: { month: string; startMonth: string | null; employees: { id: string; full_name: string; start_date: string; end_date: string | null }[]; craByEmployee: Record<string, { version: number; entries: CraEntry[] }>; assignments: AssignmentRef[]; projects: (ProjectRef & { title: string; pricing_model: string; client_id: string; intermediary_client_id: string | null })[]; extensionsByProject: Record<string, ExtensionRef[]>; clients: { id: string; name: string }[]; linkedClientIds: Set<string>; productsByProject: Record<string, Record<string, ProductRef>>; invoices: InvoiceRowRef[] }): ToInvoiceRow[];
// sync.ts
export type LinkContext = { clientLinks: { client_id: string; provider_client_id: string }[]; projects: { id: string; pricing_model: string; client_id: string; intermediary_client_id: string | null; start_date: string | null; end_date: string | null; extension_end_dates: (string | null)[] }[] };
export function billedClientFor(remote: ProviderInvoice, ctx: LinkContext): string | null;
export function autoLinkProject(remote: ProviderInvoice, ctx: LinkContext): string | null;
export function reconcile(existing: { id: string; provider_invoice_id: string | null; status: InvoiceStatus; project_id: string | null }[], remote: ProviderInvoice[], ctx: LinkContext): { inserts: Record<string, unknown>[]; updates: { id: string; patch: Record<string, unknown> }[]; removedDraftIds: string[] };
```
Rules:
- `toInvoiceRows`: returns `[]` when `month < startMonth` or `startMonth` is null. One row per (employee, régie project) with `days > 0` in that month. `amountHt` from `buildDraftLines` totals, `null` when blocked. Status/invoiceId from the non-canceled CRA invoice for the triple; `craChanged` = invoice exists and `invoice.cra_version !== craByEmployee[e].version`. `cra_incomplete` when `missingWorkingDays` is non-empty. Billed client = intermediary ?? client; `client_not_linked` if not in `linkedClientIds`.
- `missingWorkingDays`: weekdays of the month, not French holidays, inside employment dates, not fully covered (a day needs `full` or both `am` and `pm`).
- `autoLinkProject`: billed client via link; candidate régie projects where `(intermediary_client_id ?? client_id) === billedClient`; active on `periodStart ?? issueDate` (`start_date <= d` and `max(end_date, extension_end_dates)` is null or `>= d`); exactly one → its id, else `null`.
- `reconcile`: remote id unknown → insert `{source:"imported", status, number, provider_invoice_id, provider_client_id, billed_client_id, project_id: autoLinkProject(...), dates, totals, invoice_url, purchase_order}`; known → update status/number/totals/dates/paid_at/finalized_at/invoice_url only (never overwrite `project_id`, `employee_id`, `period_month`, `ignored`); our `draft` rows whose `provider_invoice_id` is absent from remote → `removedDraftIds`.

- [ ] **Step 1: Write failing tests**:
  - month: `before start month returns nothing` (`month:"2026-10"`, `startMonth:"2026-11-01"` → `[]`).
  - month: `row with amount and invoiced status` — one employee, 18 days, linked client and product, existing `draft` CRA invoice with `cra_version` 3 while CRA version 4 → row `{days:18, amountHt:"11700.00", status:"draft", craChanged:true, blockers:[]}`.
  - month: `intermediary is billed and must be linked` — project with `intermediary_client_id` not in `linkedClientIds` → `billedClientId` = intermediary id, `blockers` includes `"client_not_linked"`.
  - month: `missing working days excludes holidays` — November 2026 with every weekday filled except 2026-11-11 (holiday) and 2026-11-12 → `missingWorkingDays` deep-equals `["2026-11-12"]`.
  - sync: `auto-links when exactly one active project`; `leaves unassigned when two active projects` (→ `project_id: null`).
  - sync: `update keeps manual assignment` — existing row with `project_id:"p2"`, remote now `paid` → update patch has `status:"paid"` and no `project_id` key.
  - sync: `draft deleted remotely is removed` — existing draft with provider id absent → in `removedDraftIds`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/invoicing-month.test.mjs tests/invoicing-sync.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `month.ts` and `sync.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/admin/server/invoicing/month.ts apps/admin/server/invoicing/sync.ts tests/invoicing-month.test.mjs tests/invoicing-sync.test.mjs && git commit -m "feat(invoicing): to-invoice rows and Qonto sync reconciliation"`

---

### Task 5: Encrypted settings and the API handler — configuration resources

**Files:**
- Modify: `apps/admin/server/ai-settings.ts` — add `encryptSecret(value: string, aad: string)` / `decryptSecret(value: string, aad: string)`; `encryptApiKey`/`decryptApiKey` become wrappers with AAD `quicksort/cv-analyzer/v1` (existing `tests/ai-settings.test.mjs` must stay green).
- Create: `apps/admin/server/invoicing/settings.ts`, `apps/admin/api/invoicing.ts`
- Test: `tests/invoicing-api.test.mjs`

**Interfaces:**
- Produces:
```ts
// settings.ts
export const INVOICING_AAD = "quicksort/invoicing/v1";
export type InvoicingSettings = { provider: "qonto"; login: string; iban: string; staging: boolean; dueDays: number; startMonth: string | null; lastSyncedAt: string | null; hasSecret: boolean };
export async function loadInvoicingSettings(client: SupabaseClient): Promise<InvoicingSettings & { secret: string | null; stagingToken: string | null }>;
export function providerFromSettings(s: { login: string; iban: string; staging: boolean; secret: string | null; stagingToken: string | null }, fetchImpl?: typeof fetch): InvoicingProvider;
// api/invoicing.ts
export function createInvoicingHandler(deps?: { createClient: typeof createClient; createProvider: typeof providerFromSettings; now?: () => Date }): (req, res) => Promise<void>;
export default createInvoicingHandler();
```
- `encrypted_credentials` holds the encrypted JSON `{ secret, stagingToken }`.
- Auth: same as `api/sales-pipeline.ts` (Bearer → `sync_clerk_profile` → `user_roles.role === "admin"`, else 401/403).
- GET `?resource=`:
  - `settings` → `InvoicingSettings` (never the secret).
  - `provider-clients` → `{ clients: ProviderClient[], links: invoicing_client_links rows }`.
  - `provider-products` → `{ products: ProviderProduct[] }`.
  - `payment-accounts` → `{ accounts: PaymentAccount[] }`.
- POST `{ action }` (zod-validated; unknown action → 400):
  - `save_settings {login, secret?, stagingToken?, iban, staging, dueDays (1..120), startMonth "YYYY-MM"}`: when `secret` is given, first call `listPaymentAccounts()` with the new credentials; on `ProviderError` respond 400 with its message and do not save.
  - `link_client {clientId, providerClientId, providerClientName}` (upsert; `providerClientId: null` deletes the link).
  - `link_product {projectId, pricingLine, product: ProviderProduct | null}` (upsert copying title/description/unit/vatRate; null deletes).
- Provider not configured → 409 `{ error: "Connect Qonto in Invoicing settings first." }`.

- [ ] **Step 1: Write failing tests** with an in-memory fake Supabase client (pattern from `tests/ai-settings.test.mjs`) and a fake provider:
  - `non-admin gets 403` for GET settings.
  - `settings never returns the secret`: saved row → response has `hasSecret:true` and `JSON.stringify(body)` contains neither the secret nor `encrypted`.
  - `save_settings rejects bad credentials`: fake `listPaymentAccounts` throws `ProviderError("Unauthorized",401)` → 400, `error === "Unauthorized"`, no upsert recorded.
  - `link_product copies product fields`: upserted row deep-equals `{project_id, pricing_line:"Data Engineer", provider:"qonto", provider_product_id:"prod-1", title:"Prestation de conseil", description:"Assistance technique", unit:"jour", vat_rate:0.2}`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/invoicing-api.test.mjs tests/ai-settings.test.mjs` — Expected: invoicing FAIL, ai-settings PASS.
- [ ] **Step 3: Implement** the encryption refactor, `settings.ts`, and the handler's auth + these resources/actions.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/admin/server/ai-settings.ts apps/admin/server/invoicing/settings.ts apps/admin/api/invoicing.ts tests/invoicing-api.test.mjs && git commit -m "feat(invoicing): encrypted Qonto settings and linking endpoints"`

---

### Task 6: API handler — invoices lifecycle and sync

**Files:**
- Modify: `apps/admin/api/invoicing.ts`
- Test: `tests/invoicing-api.test.mjs` (extend)

**Interfaces:**
- Consumes: Tasks 2–5.
- GET resources:
  - `month&month=YYYY-MM` → `{ rows: ToInvoiceRow[] }` (loads employees+hr_people names, `cra_entries`/`cra_months` of the month, assignments, régie projects, signed extensions, clients, links, product links, invoices).
  - `invoices[&refresh=1]` → runs sync when `refresh=1` or `last_synced_at` older than 5 minutes (apply `reconcile`: insert/update/delete, set `last_synced_at`), then `{ invoices: (invoice row + project_title + client_name + consultant_name)[], lastSyncedAt }`.
  - `invoice&id=` → `{ invoice, lines, events }`.
  - `project&projectId=` → `{ invoices, totals: { invoicedHt, paidTtc, outstandingTtc }, rows: ToInvoiceRow[] }` where `rows` = that project's not-invoiced consultant months from start month up to the previous month.
- POST actions (each appends an `invoice_events` row with `kind` = the action and `actor` = profile id):
  - `create_draft {projectId, employeeId, month}`: if a non-canceled CRA invoice exists for the triple, return it (200, no provider call). Otherwise build with `buildDraftLines` (blocked → 422 with blocker), insert our `invoices` row (`status:"draft"`, `source:"cra"`, `cra_version`) — unique violation (`23505`) → load and return the existing row — then `provider.createDraft`; on provider failure delete our row and return 502 with the provider message; on success store `provider_invoice_id`, totals from the provider response, and `invoice_lines` (with `computed_*`).
  - `update_draft {invoiceId, dueDate, purchaseOrder, lines:[{id, quantity, unitPrice, description}]}`: only `status='draft'`; `provider.updateDraft` with all lines, then save.
  - `regenerate_draft {invoiceId}`: rebuild lines from current CRA, `updateDraft`, update `cra_version`.
  - `delete_draft {invoiceId}`: `provider.deleteDraft`, delete our row.
  - `finalize {invoiceId}`: `provider.finalize`; set `status:"finalized"`, `number`, `finalized_at`, `invoice_url`, totals.
  - `send {invoiceId}`: only `finalized`/`paid`; recipients = `getInvoice(...).clientEmails`; empty → 422 `"This client has no invoice email in Qonto."` without calling `send`; subject `Facture ${number} — Quicksort`; body `Bonjour,\n\nVeuillez trouver ci-joint la facture ${number} pour la période ${monthLabelFr}.\n\nCordialement,\nQuicksort`; set `sent_at`.
  - `cancel {invoiceId}`: only `finalized`; `provider.cancel`; `status:"canceled"` (releases the CRA lock and the unique triple).
  - `assign {invoiceId, projectId | null, ignored?: boolean}`: only `source='imported'`.

- [ ] **Step 1: Write failing tests**:
  - `create_draft twice makes one provider call`: second request returns 200 with the same invoice id; fake provider `createDraft` call count is 1.
  - `create_draft rolls back on provider failure`: `createDraft` throws `ProviderError("client_id is invalid",422)` → 502, `error === "client_id is invalid"`, no `invoices` row remains.
  - `blocked draft returns 422`: no product link → 422 body `{ blocker: "product_not_linked" }`.
  - `send refuses client without email`: `getInvoice` returns `clientEmails: []` → 422 with the exact message, `send` not called.
  - `finalize stores number and status`: provider returns `{status:"finalized", number:"F-2026-0042"}` → row updated, event `finalize` recorded.
  - `sync keeps manual project assignment` via `invoices&refresh=1` with an imported row assigned to `p2` and remote status `paid` → row `project_id === "p2"`, `status === "paid"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/invoicing-api.test.mjs` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the resources and actions.
- [ ] **Step 4: Run** `pnpm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add apps/admin/api/invoicing.ts tests/invoicing-api.test.mjs && git commit -m "feat(invoicing): draft, validate, send, cancel and sync endpoints"`

---

### Task 7: Sales → Invoicing page

**Files:**
- Create: `apps/admin/src/sales/invoicing/api.ts`, `Invoicing.tsx`, `InvoiceDraftPanel.tsx`, `InvoicingSettings.tsx`, `format.ts`, `invoicing.css`
- Modify: `apps/admin/src/App.tsx` (nav item `{ id: "sales-invoicing", href: "/sales/invoicing", label: "Invoicing" }` after Projects, add to `salesTabIds`, route `/sales/invoicing/*`)

**Interfaces:**
- Produces `useInvoicingApi(): { get<T>(params: Record<string,string>): Promise<T>; post<T>(action: string, body: object): Promise<T> }` (Clerk `useSession().session.getToken({ template: "supabase" })`, same error handling as `AiSettings.request`, path `/api/invoicing`).
- Produces `format.ts`: `invoiceStatusLabel(status, dueDate): "Draft" | "Validated" | "Overdue" | "Paid" | "Canceled"` (Overdue = finalized and `dueDate < today`), `blockerLabel(blocker)` with copy: `client_not_linked` "Link this client to Qonto", `no_pricing_line` "Pick a pricing line on the staffing", `no_rate` "No TJM for these dates", `product_not_linked` "Link this pricing line to a Qonto service", `cra_incomplete` "CRA has unfilled working days".
- Page tabs: **To invoice** (month selector, default previous month; table consultant/project/billed client/days/TJM amount/status; blockers as inline links to the fix; "Create draft" per row and for selected rows), **Invoices** (filters status incl. Overdue, client, project, month; refresh button showing last sync), **Unassigned** (imported, `project_id` null and not ignored; project picker; "Not project-related"), **Settings** (Qonto login, secret (write-only), staging token, IBAN select from `payment-accounts`, due days, start month; client links table with Qonto client select; pricing line → product links per régie project).
- `InvoiceDraftPanel` (side sheet like project sheets): lines with editable quantity/unit price/description, highlighted when different from `computed_*`; due date; PO; totals HT/TVA/TTC; "CRA changed — regenerate" banner when `craChanged`; buttons Validate (confirm dialog in-page showing TTC; no `window.confirm`), Delete draft, Regenerate; after validation: Send (shows recipients from `invoice` resource), Open in Qonto (`invoice_url`), Cancel invoice.
- Use the existing Sales styling (`sales.css`, `projects-tabs`, `pj-card`) and admin tokens; no new colors.

- [ ] **Step 1: Implement** the files above.
- [ ] **Step 2: Run** `pnpm --filter @quicksort/admin typecheck` — Expected: no errors.
- [ ] **Step 3: Verify in the browser** (run skill / `pnpm dev`, sandbox Qonto credentials if available): settings save rejects a bad key with the Qonto message; To invoice lists last month; Create draft → panel; Validate → status Validated with number.
- [ ] **Step 4: Commit** `git add apps/admin/src/sales/invoicing apps/admin/src/App.tsx && git commit -m "feat(invoicing): Sales invoicing page"`

---

### Task 8: Project invoices section and CRA lock UI

**Files:**
- Create: `apps/admin/src/sales/invoicing/ProjectInvoices.tsx`
- Modify: `apps/admin/src/sales/Projects.tsx` (mount `<section className="pj-card"><ProjectInvoices projectId={editing.id} /></section>` before the Notes card, régie projects only), `apps/admin/src/cra/domain.ts` (`snapshotSchema` gains `invoiced: z.boolean().default(false)`), `apps/admin/src/cra/CraScreen.tsx`

**Interfaces:**
- Consumes: `useInvoicingApi`, `InvoiceDraftPanel`, `format.ts` (Task 7); GET `project` resource (Task 6).
- `ProjectInvoices`: totals (Invoiced HT, Paid, Outstanding), invoice list with status pills, "Not invoiced yet" rows with Create draft; clicking an invoice opens `InvoiceDraftPanel`.
- CRA screen: when `snapshot.invoiced` and the viewer is the consultant (not admin/HR), cells and Save are disabled with notice "This month has been invoiced and is locked. Ask an admin to change it."; admin/HR see a warning notice "A validated invoice covers this month — changes will not update it." and can edit.

- [ ] **Step 1: Write failing test**: extend `tests/cra.spec.ts` (Playwright, existing harness) with `invoiced month is read-only for the consultant` — snapshot fixture `invoiced:true`, consultant role → Save button disabled and the lock notice visible.
- [ ] **Step 2: Run** `pnpm test:browser tests/cra.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modifications and `ProjectInvoices.tsx`.
- [ ] **Step 4: Run** `pnpm test:browser tests/cra.spec.ts && pnpm --filter @quicksort/admin typecheck && pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/admin/src/sales/invoicing/ProjectInvoices.tsx apps/admin/src/sales/Projects.tsx apps/admin/src/cra/domain.ts apps/admin/src/cra/CraScreen.tsx tests/cra.spec.ts && git commit -m "feat(invoicing): project invoices section and CRA lock"`

---

## Notes for the executor

- Webhooks and a scheduled cron are out of v1: sync is on demand + 5-minute throttle (spec leaves this to the builder).
- Lock granularity chosen: whole consultant-month (spec leaves this to the builder).
- `packages/hr-db/src/database.types.ts` is not regenerated; server code uses untyped `SupabaseClient` like `api/sales-pipeline.ts`.
- Add `https://thirdparty.qonto.com` to nothing in the CSP: the browser never calls Qonto.
