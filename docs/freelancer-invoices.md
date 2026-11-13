# Freelancer invoices

How the invoices freelancers send us are collected, checked against their CRA, and marked paid from Qonto. Scope: people whose contract type is `Freelance` only. Admin page: Sales → Freelancer invoices.

## Intake

Every invoice lands as **To check**, whatever its source.

- **Portal upload.** Freelancers only, on their own portal tab. PDF only, 3 MB at most. The tab stays open for 90 days after a freelance employment ends, for the final invoice. When a person has an open freelance employment, invoices go to that one.
- **Admin upload.** In the freelancer's panel, "Upload invoice" files a PDF for them (same checks), for an invoice that arrived some other way.
- **Matching right away.** After a new upload, review and payment matching run at once (no mail poll); if that fails, the upload still succeeds and the next cron catches up.
- **Email.** The configured mailbox is read through Gmail (read-only).
  - Only messages `from:` a freelancer's person email or one of the extra emails in their billing details, with a PDF attachment, are listed. Freelancers ended in the last 90 days are included, for their final invoice. Other messages are never listed.
  - Each listed message is first read as headers only (sender and date). Only a message from a known address that belongs to a single freelancer is opened in full, and only its PDF attachments are downloaded. A message from an unknown or shared address is never opened: it is recorded as done with the reason, so it is not looked at again.
  - The first run goes back to 1 Jan 2026 (the backfill date setting); later runs continue from the last poll. Changing the mailbox or the backfill date starts again from the backfill date.
  - A run reads mail for at most 150 s, then leaves the rest for the next run.
  - Each message read is recorded. Done messages are never read again; failed ones are retried on the next runs, up to 5 attempts, then given up with the error kept (file those by hand).
- **Reading the PDF.** Kimi (Moonshot) extracts number, dates, period, HT / VAT / TTC, credit-note flag and issuer IBAN. It uses the key and model saved in the AI settings (Settings → Kimi). If the read fails, the invoice is still stored, flagged `unreadable`, for an admin to complete.
- **Storage.** The PDF is filed in Drive under the person's folder, in `09_Factures`, as a `FREELANCE_INVOICE` document.
- **Duplicates.** Same freelancer and invoice number, or same file hash: no new invoice is created; the event is logged on the existing one. A rejected invoice frees its number, so a corrected invoice may reuse it; the rejected file itself is still a duplicate.
- **Due date.** The date printed on the PDF, otherwise invoice date + 30 days.

## Setup

1. **Gmail delegation (Google Workspace admin).** The Drive service account also reads the mailbox.
   - Admin console → Security → Access and data control → API controls → Manage domain-wide delegation → Add new.
   - Client ID: the client ID of the Drive service account.
   - Scope: `https://www.googleapis.com/auth/gmail.readonly` (nothing more).
   - The Gmail API must be enabled in the service account's Google Cloud project.
2. **Mailbox and backfill date.** Sales → Freelancer invoices → settings. The mailbox starts as `mohamed@quicksort.fr`; it is a setting, not code.
3. **`CRON_SECRET`.** Set in the admin app's environment (shared with the bank sync cron). The cron endpoint refuses calls without it.
4. **Hourly cron.** `apps/admin/vercel.json` runs `/api/freelancer-invoices-cron` at minute 0 of every hour (max 300 s). Hourly crons need a Vercel plan that allows them (Hobby only allows daily).
5. **Qonto.** Connected and syncing (Settings, bank sync): payment matching reads the synced debits.

Each cron run: poll the mailbox (one poll at a time, 10 min lock), auto-approve, then match payments.

## Statuses

- **To check.** Waiting for review.
- **To pay.** Approved, not yet paid (marked overdue past the due date).
- **Paid.** Linked to a bank debit.
- **Missing.** A freelancer has CRA client-project days for the month and no live invoice.
- **Rejected.** Excluded from checks, payment and the business plan.

Flags (why an invoice cannot be approved automatically):

- `not_invoice`: Kimi read the file and it is not an invoice.
- `unreadable`: extraction failed, or no HT amount or period. Fixing the fields in the admin clears it.
- `iban_changed`: the IBAN on the invoice differs from the one on file.

**Auto-approval.** An invoice with no flags moves to To pay when its freelancer's month check passes (difference under €1). A month with CRA days that lack a daily rate is never auto-approved. An admin decision made in between wins.

## CRA check

For a freelancer and month:

- **Expected** = Σ client-project days (full day = 1, am/pm = 0.5) × the daily rate (TJM) in effect on each day.
- **Invoiced** = Σ HT of non-rejected invoices for the month, credit notes counted negative. Credit-note amounts are stored negative whatever sign an admin types.
- **OK** when `|invoiced − expected| < €1`.
- No CRA, a missing rate, or an unreadable invoice amount means no automatic pass.

## Payment matching

Compares the invoice **TTC** with the absolute amount of completed Qonto debits settled on or after the invoice date. Credit notes, paid and rejected invoices are not matched, and a debit already used or confirmed is never reused.

- **Confident (marked paid automatically)** only when all hold:
  - the invoice has exactly one candidate debit, and that debit is a candidate of exactly one invoice;
  - the amount equals the TTC exactly;
  - the debit settled on or after the invoice date;
  - the payee matches by IBAN, or by exact name (if both IBANs are known and differ, a name match is not enough).
- **Suggested for a human** otherwise: fuzzy name, amount differs, or several candidates. An admin confirms or dismisses in the invoice panel.
- **Lump payments.** One debit paying several invoices: an admin links them with "Also pays…".
- **Billing from a payment.** Confirming a suggested payment fills the freelancer's empty billing IBAN and company name from the debit (logged). Unlinking a payment clears billing details still equal to that debit's IBAN or payee (logged), so a wrong confirmation does not steer later automatic matches.
- **Atomic.** `freelancer_invoice_mark_paid` does it in one transaction under a per-debit advisory lock. It refuses if the debit already pays another invoice or an invoice is already paid or rejected, so concurrent confirmations cannot double-use a debit.

## Business plan

For a closed month, the invoiced HT (non-rejected, with a period, credit notes negative) replaces the CRA × TJM estimate for that freelancer and month. Without an invoice, the CRA × TJM (or open-days) estimate remains.

## Access

All tables are admin-only. A freelancer sees only their own invoices in the portal, with status received / to pay / paid / not accepted (rejected), never review notes or mismatch details.
