# Client invoicing from CRA, via Qonto — design

Date: 2026-10-28 · Status: draft for review

## Intent

Today every client invoice is built by hand in the Qonto web app: pick the
client, pick a predefined "Produit et service", type the number of days, send.
The days come from the CRA in the admin app, so the work is copy-paste, and
nothing in the admin app shows which invoices went out for a project or
whether they were paid.

We want the admin app to:

1. connect to Qonto (Quicksort's bank, which also does invoicing),
2. retrieve invoices and show them on the project they belong to,
3. track their status (draft → unpaid → paid / canceled, plus overdue),
4. generate a **draft** invoice from a consultant's CRA for a month,
5. let an admin **validate** (finalize) it,
6. **send** it to the client.

Qonto stays the system of record for numbering, PDF, sending and payment. The
admin app is the place where invoices are prepared and followed per project.

## Goals

- Monthly régie invoicing: **one invoice per consultant, per project, per
  month**. Amount = CRA days on that project × TJM of the consultant's pricing
  line.
- Billed party = the project's intermediary when set
  (`sales_projects.intermediary_client_id`), else the main client.
- Every pricing line (`tjm_profiles` entry on the contract or an extension) can
  be associated with one Qonto product ("Produits et services"); the invoice
  line takes its title/description/unit from that product. VAT is 20%.
- Invoices created directly in Qonto (past and future) also appear in the admin
  app, attached to a project, with their paid status.
- Once an invoice is finalized, the consultant can no longer edit the CRA days
  it covers.
- **Provider-agnostic**: Qonto is the first implementation of an invoicing
  provider interface; replacing it later (another bank/tool, in-house PDF) must
  not require changing screens or the invoice data model.

## Non-goals (for now)

- Forfait (fixed-price) projects. Ignore them; design shouldn't make them hard
  later (a forfait invoice is just a line with a fixed amount).
- Grouping several consultants on one invoice.
- Quotes, recurring invoices, reminders, e-invoicing (Factur-X / PDP).
- Editing Qonto clients or products from the admin app (we read them and link
  to them).
- Bank transaction reconciliation — "paid" comes from Qonto's invoice status.

## Anti-goals

- A wrong amount reaching a client. Nothing is finalized or sent without an
  explicit admin action, and the draft shows exactly what will be invoiced
  (days, TJM, total HT/TVA/TTC) before validation.
- Duplicate invoices for the same consultant × project × month.
- The Qonto secret ever reaching the browser.
- Qonto-specific fields leaking into screens and core tables.

## Decisions made with Mohamed

- One invoice per consultant (multi-consultant projects get several invoices).
- Forfait deferred.
- Pricing line ↔ Qonto product mapping, VAT 20%.
- Design behind a provider abstraction.
- **Only admins** (`private.is_admin()`) can validate and send. My call:
  admins only for every invoicing action (create drafts, link invoices,
  configure), and only admins can see the Invoicing screens.
- Past Qonto invoices must show in the admin app, with paid status.
- CRA is locked for the consultant once the invoice covering it is issued.
- Recipient email: the one already configured on the client in Qonto.
- UI lives in **Sales** (a new Invoicing tab) and **inside each project**.

## Calls I made (Mohamed can override)

- **Months**: an invoice covers a calendar month. Issue date = the day it's
  created; performance period = first..last day of the month; due date =
  issue date + the client's payment terms from Qonto if available, else 30
  days.
- **Days**: half-day CRA entries (`part` am/pm) count 0.5. Only
  `client_project` entries for that project count.
- **Which TJM**: the TJM of the pricing line on the consultant's assignment
  (`employee_project_assignments.pricing_line`), taking extensions into
  account (the line valid on those dates). If the TJM changes mid-month
  (extension starts mid-month), the invoice gets one line per rate period.
  If an assignment has no pricing line and the project has exactly one line,
  use it; otherwise the row is blocked with "pick a pricing line".
- **Invoice line text**: title = Qonto product title (≤40 chars); description =
  product description, or "Consultant : <name> — <Month YYYY>" when the
  product has none; unit =
  product unit (default "jour"); quantity = days; unit price = TJM; VAT 20%.
  Header/purchase order left for the builder to expose as optional fields on
  the draft (purchase_order is commonly asked by clients).
- **Draft editing**: the admin can adjust quantity, unit price, description,
  purchase order and due date on the draft before validating. Edits are
  pushed to the provider (Qonto supports updating drafts). Adjusted values are
  kept and shown as differing from the CRA-computed values.
- **Lock timing**: drafts don't lock. Finalizing locks the consultant's CRA
  for that month **for that project's days** (simplest acceptable: lock the
  whole CRA month for that consultant — builder may choose, see below). If the
  CRA changes while an invoice is still a draft, the draft is flagged "CRA
  changed — regenerate".
- **Unlock**: if the invoice is canceled (in Qonto via credit note, or from the
  admin app), the lock is released. The lock targets the consultant only:
  admins and HR (`private.cra_access` operators) can still edit a locked CRA,
  with a visible warning that a finalized invoice covers it, and the invoice
  is flagged "CRA changed after finalization".
- **"CRA incomplete"** is a warning, not a blocker. It's derived from data:
  working days (excluding weekends and `frenchHolidays`, within employment and
  assignment dates) that have no entry. No new "submitted" state on the CRA.
- **Linking retrieved invoices to projects**: invoices created from the admin
  app are linked at creation. Invoices imported from Qonto are auto-linked
  when the billed client maps to exactly one régie project active on the
  invoice's performance/issue date; otherwise they sit in **Unassigned**
  until an admin picks a project (and optionally a consultant + month). An
  admin may also mark an imported invoice "not project-related" to hide it.
- **Go-live month** (decided with Mohamed): a configurable start month in
  invoicing settings (e.g. 2026-11). "To invoice" and a project's
  "not yet invoiced" months only cover months ≥ start month. Imported
  (pre-launch) invoices are only linked to a project and shown with their
  status/amounts; they are never matched to consultant-months.
- **Imported invoices spanning several projects** (my call, unconfirmed):
  linking stays per invoice. An admin attaches it to the main project; no
  line-level split in v1.
- **Status sync**: pull on demand (refresh button + on opening the screens,
  throttled) and a scheduled sync; Qonto webhooks (`v1/client-invoices`) can
  be added as an accelerator. Builder decides whether webhooks are in v1.
- **Overdue** is derived: status unpaid and due date passed.

## Data model (provider-agnostic)

New tables (names indicative):

- `invoicing_settings` — single row: active provider (`'qonto'`), encrypted
  credentials (same AES-GCM pattern as `server/ai-settings.ts`, own AAD),
  provider options (Qonto: login/organization slug, IBAN to put on invoices,
  staging flag), last sync time.
- `invoicing_client_links` — `sales_clients.id` ↔ provider client id.
- `invoicing_product_links` — (project id, pricing line name) ↔ provider
  product id + cached title/description/unit/vat. Pricing lines are
  identified by name inside `tjm_profiles` today (contract and extensions);
  builder may introduce a stable key if names are unreliable.
- `invoices` — our record: id, provider, provider_invoice_id (unique),
  number, project_id (nullable until assigned), billed client_id,
  employee_id (nullable for imported), period_month (nullable for imported),
  status (`draft | finalized | paid | canceled`), issue/due/paid dates,
  amounts HT/TVA/TTC, currency, source (`cra | imported`), cra snapshot
  hash/version used to build it, pdf url/attachment id, sent_at,
  created_by, timestamps, `ignored` flag.
  Unique constraint on (project_id, employee_id, period_month) for
  non-canceled CRA invoices → prevents duplicates.
- `invoice_lines` — quantity, unit, unit_price, vat_rate, title,
  description, pricing line ref, computed-vs-adjusted flags.
- `invoice_events` — audit trail (created, edited, finalized, sent, paid,
  canceled, linked) with actor.

RLS: admin-only read/write on all of these. CRA lock is enforced in the
database (the existing CRA save path rejects edits by non-admins to a month
covered by a finalized/paid invoice).

## Provider interface

Server-side only (`apps/admin/server/invoicing/`), roughly:

```
listClients(), listProducts()
listInvoices({ updatedSince })            -> ProviderInvoice[]
getInvoice(id)
createDraft(InvoiceDraft)                 -> ProviderInvoice
updateDraft(id, InvoiceDraft)
deleteDraft(id)
finalize(id)                              -> ProviderInvoice (number, pdf)
send(id, { to?: string[] })               // defaults to client's emails
cancel(id)
markPaid(id) / unmarkPaid(id)             // optional
```

Types are ours (amounts as decimal strings, our status enum). The Qonto
adapter maps them onto the Business API:

- Auth: API key (`Authorization: <login>:<secret>`), from settings.
  Sandbox via `X-Qonto-Staging-Token` when configured.
- `GET /v2/clients`, `GET /v2/products`
- `GET /v2/client_invoices` (filters: status, updated_at_from;
  `exclude_imported=false`), `GET /v2/client_invoices/{id}`
- `POST /v2/client_invoices` with `status: "draft"`, `client_id`,
  `issue_date`, `due_date`, `currency`, `payment_methods.iban`,
  `performance_start_date`/`performance_end_date`, `purchase_order`, `items[]`
  (title ≤40, quantity as string, unit_price {value,currency}, vat_rate
  "0.2", unit, description). Items have no product id: product data is
  copied in.
- `PATCH` draft, `DELETE` draft, finalize, mark-as-canceled, mark paid —
  the dedicated client-invoice endpoints.
- Send: `POST /v2/client_invoices/{id}/send` with `send_to` = the Qonto
  client's email(s), `email_title` (e.g. "Facture <number> — Quicksort"),
  optional body. `copy_to_self` default.
- PDF via attachment (generated asynchronously; poll/refresh).

HTTP endpoints in `apps/admin/api/invoicing*.ts` follow the existing pattern
(Bearer token → Supabase client → `sync_clerk_profile` → admin check). They
call the provider and write our tables; the browser never talks to Qonto.

## Flows

**Configure (admin, Settings or Invoicing → Settings)**: paste Qonto login +
secret key, test connection, choose the IBAN for invoices. Then link clients
(suggested by name/SIREN/VAT match, confirm) and pricing lines to products.

**To invoice (Sales → Invoicing, month selector, default previous month)**:
one row per consultant × régie project with CRA days that month. Columns:
consultant, project, billed client, days, TJM, amount HT, status (not
invoiced / draft / finalized / paid). Blockers shown inline: client not
linked, pricing line not linked, CRA incomplete for the month, no TJM.
Action: Create draft (single or selected rows).

**Draft review**: shows lines, totals HT/TVA/TTC, billed client and its
Qonto email, period; editable fields above; buttons: Validate (finalize),
Delete draft, Regenerate from CRA. Validate asks for confirmation showing
the total TTC. After validation: Send (confirm recipients), Open PDF.

**Invoices list**: all invoices (CRA-generated and imported), filter by
status (incl. overdue), client, project, month; actions per state.

**Unassigned**: imported invoices without a project → pick project
(and optionally consultant + month), or mark not project-related.

**Project → Invoices section**: list of the project's invoices with status,
totals invoiced / paid / outstanding, and the not-yet-invoiced consultant
months with "Create draft".

## Edge cases to handle

- Qonto call fails mid-flow → our record reflects the last confirmed state;
  retries must not create a second Qonto invoice (look up by our id stored
  in a draft field, or reconcile by client + period before re-creating).
- Invoice finalized or canceled directly in Qonto → sync updates ours.
- Draft deleted in Qonto → ours marked removed/re-creatable.
- Amounts: decimal arithmetic, rounding to cents per line as Qonto does;
  our stored totals come from Qonto's response after creation.
- Consultant without a CRA month record, or CRA with zero project days → no
  row.

## Left to the builder

- Lock granularity (whole consultant-month vs only that project's days) —
  either satisfies "consultant can't edit after issue".
- Whether webhooks are in v1 or polling only.
- Exact table/column names, migration split, UI component structure (follow
  existing Sales screens and the admin design tokens).
- Stable identifiers for pricing lines if names prove fragile.
- Credit notes: v1 only needs to detect cancellation via status; creating
  credit notes from the admin app is optional.
