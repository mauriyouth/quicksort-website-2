# Freelancer invoices — design

Date: 2026-11-11 · Status: draft for approval

## Why

Freelancers email their monthly invoice (a PDF) to Mohamed. Someone pays it later by Qonto transfer, and today nothing records whether an invoice arrived, whether it matches the work done, or whether it was paid — finding out means digging through the inbox and the bank. The admin app already knows each freelancer's CRA days and TJM, and already syncs Qonto debits, so it can close that loop.

Success: one page in admin answers "for month X, which freelancers have invoiced, does each invoice match their CRA, and which are paid?" without opening Gmail or Qonto.

## Goals

1. **Collect invoices from two sources**
   - Freelancers upload their invoice in their portal.
   - The app picks up invoices that arrive by email in mohamed@quicksort.fr.
2. **Read each PDF:** invoice number, invoice date, period (month), amount HT, VAT, TTC and due date. A human can correct any of these.
3. **Check each invoice against the CRA:** CRA client days × TJM for that month, compared with the invoice amount HT. Mismatches are flagged.
4. **Mark invoices paid automatically** when a matching Qonto debit is found.
5. **Show everything on one page,** "Freelancer invoices" under Sales next to client Invoicing, with month filtering and status tabs.
6. **Use real costs in the business plan:** it uses the invoiced amount HT as freelancer cost for a month, and falls back to the current CRA × TJM estimate when there is no invoice yet.

## Non-goals

- Paying invoices from the app. No transfers are initiated; Qonto stays where money moves.
- Invoices from anyone other than freelancers (other suppliers, SaaS, rent). Those stay in the existing bank-transaction classification.
- A CRA approval workflow.
- Sending reminders to freelancers about missing invoices. This could come later.

## Anti-goals (would make this a failure even if it works)

- **Reading the rest of Mohamed's mail.** Only messages *from a known freelancer address* that *have a PDF attachment* are fetched. Nothing else is read or stored.
- **Marking an invoice paid on a weak match.** A wrong "paid" is worse than a missing one. When in doubt, ask a human.
- **Duplicates.** The same invoice arriving by email and by portal upload must show once.

## Decisions made with Mohamed

- **Both intake paths:** portal upload and automatic pickup from mohamed@quicksort.fr. A dedicated inbox such as factures@ may replace that address later, so the mailbox address is a setting, not hard-coded.
- **Which emails are picked up:** the sender address matches a known freelancer address, and the email has a PDF attachment.
- **Paid status is automatic,** by matching Qonto debits.
- **CRA check:** CRA days × TJM is compared with the invoice, and mismatches are flagged.
- **Layout:** a single cross-freelancer page (option A in the mockup), not a tab on each person.
- **Business plan:** it switches to real invoiced amounts when available.
- **Several invoices per month are possible** (per project, corrections, credit notes).
  - The CRA check compares the **sum** of a freelancer's non-rejected invoices HT for a month with that month's CRA days × TJM. Credit notes count as negative.
  - The month row shows the total, and each invoice can be expanded.
  - Duplicates are detected by invoice number or file hash, never by "same month".
- **Past invoices are picked up:**
  - **Email:** the first email run goes back to **1 January 2026**, still limited to freelancer senders with a PDF attached.
  - **Bank:** past invoices are matched against the Qonto debits already synced.
  - **Business plan:** closed months since January 2026 switch from estimates to invoiced amounts.
  - **Ambiguous matches:** where several same-amount debits make a match unclear (monthly repeats), it stays "probable" for a human to confirm.

## How it behaves

### Statuses (per invoice; Missing is per freelancer × month)

| Status | Meaning |
|---|---|
| **Missing** | The freelancer has CRA client days for the month, but no invoice has been received. This row is computed, not stored. |
| **To check** | An invoice was received, but the CRA check failed, a key field couldn't be read from the PDF, or the period is ambiguous. |
| **To pay** | The invoice is consistent with the CRA (or an admin accepted the difference) and is not yet paid. It shows the due date and is highlighted when overdue. |
| **Paid** | A Qonto debit was matched (automatically or confirmed by an admin), with the date of the debit. |

From **To check**, an admin can:
- fix the fields read from the PDF;
- accept the difference with a short reason (for example, agreed expenses or a pro-rata adjustment), which moves the invoice to To pay;
- reject a non-invoice or a duplicate.

### CRA check

- **Expected amount:** CRA client-project days for that freelancer and month × their daily rate (`employee_salaries.daily_rate` in effect that month), with half days counted as 0.5. This uses the same counting as `sales_project_cra_consumption`.
- **What it's compared with:** the sum of the freelancer's non-rejected invoices HT for that month. A difference under €1 counts as a match (rounding).
- **The row shows both numbers,** for example "13 d × €650 = €8,450 vs invoice €9,100".
- **No CRA for that month:** the invoice goes to To check with "no CRA".

### Payment matching

- **Candidates:** Qonto debits (`bank_transactions`) settled on or after the invoice date, whose amount equals the invoice TTC (the amount actually transferred).
- **Confident match** (auto → Paid): the counterparty matches the freelancer, and exactly one candidate fits.
  - The counterparty matches when its IBAN is the IBAN on the freelancer's RIB, or its name matches the freelancer's name or company name.
  - The amount must be exact.
- **Probable match** (suggested): the amount is exact but the name is fuzzy, or the name matches but the amount differs (for example, two invoices paid in one transfer). This is shown as "Probably paid by <transfer> — confirm?", and an admin confirms or dismisses it.
- **Each debit pays at most one invoice,** except when an admin explicitly links one debit to several invoices.
- **When it runs:** after each bank-transactions sync (the existing cron) and when a new invoice is added.

### Intake

**Portal**
- In the freelancer portal, a new "Invoices" section has upload, the freelancer's own past invoices and their status (received / to pay / paid).
- The status is shown without internal notes about mismatches.

**Email**
- A scheduled job lists new messages in the configured mailbox from any address in the freelancer address list, with a PDF attachment.
- For each one, it downloads the PDFs and creates invoices with source = email, keeping the Gmail message ID to avoid reprocessing.
- **Known freelancer address:** the freelancer's person email, plus any extra billing addresses an admin adds per freelancer (accountants or company mailboxes often send invoices).
- **More than one PDF on an email:** each is treated as a candidate invoice. Anything that doesn't read as an invoice goes to To check, so an admin can reject it.

**Shared steps**
- **Reading the PDF:** text extraction plus an LLM extraction, reusing the existing `extractPdfText` and the Kimi/AI-settings setup used for CV parsing.
- **Storage:** the PDF is stored in Google Drive in the freelancer's people folder through the existing `DocumentStorage`, and registered in `documents` with a new document type `FREELANCE_INVOICE`.
- **Duplicates:** the same freelancer plus the same invoice number, or an identical file hash, is a duplicate. It is linked to the existing invoice, not created again.

### Page: Sales → Freelancer invoices

- **Filters:** a month picker (defaults to last month), then the tabs All / To check / To pay / Paid / Missing, with counts.
- **Columns:** freelancer, invoice number, amount (HT and TTC), CRA check (✓ or the mismatch detail), received (source and date), status (with the paid date or due date).
- **Row detail:**
  - a PDF preview link;
  - editable extracted fields;
  - the CRA breakdown by project;
  - the matched or suggested Qonto transaction with confirm/unlink;
  - the history (who changed what).
- **Access:** admin only, like client invoicing.

### Business plan

In `actuals.ts`, freelancer cost for a month is the sum of that month's invoice amounts HT. Rejected invoices are excluded; all other statuses count. When a freelancer has no invoice for the month, the current CRA × TJM estimate is used and marked as an estimate in the drill-down (`FreelanceLine`).

## Constraints / existing pieces to build on

- **Freelancers:** `employees.contract_type = 'Freelance'`. TJM comes from `employee_salaries` (`rate_kind = 'daily'`).
- **CRA:** `cra_months` and `cra_entries`. Project days are counted as in `20261222090000_sales_project_cra_consumption.sql`.
- **Bank:** `bank_transactions` comes from the Qonto sync, run by `/api/bank-transactions-cron`. Its `raw` jsonb holds the full Qonto payload, including the beneficiary.
- **Documents:** the `DocumentStorage` interface, with Google Drive as the only implementation and access through a service account.
- **Portal:** `apps/admin/src/portal/HrPortal.tsx`, which already has a Documents upload flow.
- **Rules to follow:** RLS admin-only for the tables, and an events/history table in the style of `invoice_events`.

## Builder's call / assumptions made by Claude (not confirmed by Mohamed)

- **Gmail access:** use the existing Google service account with domain-wide delegation, impersonating the configured mailbox with the `gmail.readonly` scope. This needs a one-time Workspace admin step, documented in settings the way the Drive setup is. A per-user OAuth flow is an acceptable alternative if delegation isn't possible.
- **Polling cadence:** check Gmail on the same cron as the bank sync, or hourly, whichever is simpler.
- **Mismatch tolerance:** €1 HT.
- **Due date:** read from the PDF. If it's absent, use the invoice date + 30 days.
- **VAT:**
  - many freelancers are auto-entrepreneurs with no VAT, so TTC = HT and that is fine;
  - the CRA check always uses HT;
  - payment matching uses TTC.
- **Exact data model, table names, and UI component choices** are left to the builder (the admin uses `@quicksort-sas/ui`).
- **Billing details per freelancer**
  - New admin-editable fields: billing company name, SIRET and IBAN.
  - They are pre-filled from the first invoice PDF, since invoices carry the issuer's company name, SIRET and IBAN. The extraction step reads them.
  - Confirming a "probable" payment saves the debit's counterparty name and IBAN on the freelancer, so later payments match with confidence.
  - Until the IBAN or company name is known, matches stay "probable" and need a human. That is accepted.
- **Review and payment are separate.** An invoice has a review state (to check / ok / rejected) and a payment state (unpaid / paid).
  - The status shown is derived from both: Paid wins, but a paid invoice with an unresolved mismatch keeps a ⚠ badge and also appears under To check.
  - Payment matching runs on all non-rejected invoices.
- **Business plan counting**
  - Invoices count in their period month whether or not the freelancer was staffed that month (late invoices, expenses).
  - Invoices with no readable period are left out until fixed.
- **Portal uploads go to Drive** through `DocumentStorage`, not to the `candidate-documents` bucket.
- **TJM changes mid-month:** each CRA day is priced at the rate in effect on that day.
