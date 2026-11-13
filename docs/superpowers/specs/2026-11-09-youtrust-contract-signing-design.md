# Contract signing with Youtrust — design

Date: 2026-11-09 · Status: draft for approval

## Intent

Mohamed sends every contract and HR letter for signature by hand. He writes the contract from a Google Docs template, exports the PDF, uploads it to Youtrust (formerly Yousign), types in the signer's details and sends the invite. Nothing of this reaches the admin. That has three problems:

1. **Typing everything twice.** The person's name, email, dates and salary are already in the admin.
2. **No status in the app.** Finding out whether someone has signed means opening Youtrust.
3. **The signed copy stays in Youtrust.** It isn't filed into the person's Documents, where HR and the person look for it.

We want the admin to fill a Google Docs template from the person's record, send the PDF through Youtrust, follow the signature, and file the signed PDF automatically.

## Goals

- **Templates kept in Google Docs.** Mohamed keeps writing and editing them in Google Docs. The admin registers each one by its Doc link and a name. Initial templates: CDI contract, freelance (subcontractor) contract, *validation de période d'essai*, *fin de période d'essai*.
- **Fill → review → send** from a person's HR page. The admin fills the template's `{{fields}}` from the person's record, lets HR fix or complete the values, builds the PDF, shows it, and sends it through Youtrust.
- **Custom documents.** HR uploads a one-off PDF and it follows the same send, track and file flow, without a template.
- **Status in the admin.** Each person's page lists what was sent, with a live status and a link to the signed PDF.
- **Automatic filing.** When signing is complete, the signed PDF and Youtrust's audit trail are filed into the person's Documents (the HR Drive registry), so the person sees them in the portal.
- **Retire the in-app typed signature for employees.** The portal's "My contracts" page is no longer reachable for employees.

## Non-goals

- Signing inside the portal (embedded signing). The person signs from Youtrust's email link. *(decided by Mohamed)*
- Advanced or qualified signatures (identity checks). Simple signature only. *(decided by Mohamed)*
- Editing templates inside the admin. Templates are edited in Google Docs.
- Importing contracts sent directly in Youtrust, outside the admin.
- Signers other than the person and Quicksort's signatory, such as client contacts.
- Client and commercial contracts. This covers HR documents for a person only.

## Anti-goals (failures even if it "works")

- **Sending a document with an unfilled `{{field}}`** or with another person's data. Sending must be blocked while any field is empty, and the PDF HR approves is exactly the one sent.
- **Filing a signed document under the wrong person**, or filing a document that isn't fully signed as "signed".
- **Trusting an unverified webhook.** A forged call must never mark a document as signed or file a file.
- **Duplicates.** A repeated webhook or a double click on send must not create two Youtrust requests or two filed documents.
- **Exposing salary data.** Filled documents and Drive copies stay in the HR (people) Drive root, never the client contracts root, and the portal only ever shows a person their own documents.

## Decided (by Mohamed)

- **Provider:** Youtrust, the new name of Yousign since 2026. Quicksort already has an account.
- **Signature level:** simple (signer confirms with a code).
- **Signing:** by Youtrust's email link.
- **Signers:** the person (an employee or a freelance subcontractor) and Mohamed for Quicksort. Mohamed is currently the only Quicksort signatory.
- **Templates come from Google Docs**, including the probation letters, and all of them go through Youtrust.
- **Custom PDFs** must be possible alongside templates.
- **Who sends: admins only.** Only `private.is_admin()` users can see the send flow, the field values (salary) and `signature_requests`. Users with the `hr` role still see signed copies once they're filed in the person's Documents, as they do for any person document today.
- **Youtrust API access:** the plan includes an API key, webhooks and a sandbox. Build and test against the sandbox first.
- **Probation letters are filed only.** A signed letter does not change `employees.probation_status` or `probation_end`. HR updates those by hand, as today.

## Design

### 1. Templates

- **Format.** A template is a Google Doc. Fields are written `{{field_name}}` (lowercase, underscores, no accents in the name). Accented French text around them is fine.
- **Registering.** An HR settings page (next to the existing Google Drive settings) lists templates. Adding one takes:
  - a name;
  - the Google Docs link;
  - the **signers**: `person + Quicksort` (the default), `person only`, or `Quicksort only`;
  - the **document type** to file the signed copy under in the registry (for example employment contract, probation letter).
- **Access.** The template Doc must be shared with the service account already used for Drive (`apps/admin/server/documents/storage/google-drive.ts`, full `drive` scope). The settings page shows that email, and adding a template fails with a clear message if the Doc can't be read.
- **Fields.** When a template is added, and again on each send, the admin reads the Doc and lists its `{{fields}}`. A field the admin knows (see below) is filled from data. Any other field is left for HR to type in at send time, so a template can use fields the data model doesn't have.

**Known fields (first set).** These come from the person, their open employment and their accepted offer. The builder confirms the exact columns:

| Field | Source |
|---|---|
| `{{prenom}}`, `{{nom}}`, `{{nom_complet}}` | `hr_people.full_name`. Split on the first space; HR can correct it at send time. |
| `{{email}}` | `hr_people.email` |
| `{{poste}}` | employment role / offer title |
| `{{type_contrat}}` | offer `contract_type` |
| `{{salaire_brut_mensuel}}` | offer `salary_monthly`, formatted `fr-FR` (e.g. `3 500,00 €`) |
| `{{date_debut}}` | employment start date, formatted `dd/mm/yyyy` |
| `{{matricule}}` | employee matricule |
| `{{date_du_jour}}` | send date |
| `{{signataire_quicksort}}` | signatory name from settings |

Probation fields such as `{{fin_periode_essai}}` are only known fields if the probation end date is stored. Otherwise HR types them in.

### 2. Sending

On a person's HR page, a **Contracts & signatures** section has a "Send for signature" button:

1. **Choose.** Pick a template, or "Custom PDF" (upload one, PDF only, 10 MB maximum like today's `contracts` bucket).
2. **Values** (templates only). A form with one row per field: the value from data, editable, plus empty inputs for the remaining fields. Send stays disabled while any value is empty. HR also confirms the signer's name and email, prefilled from the person record.
3. **Preview.** The server copies the template Doc into the person's HR Drive folder, replaces every `{{field}}` (Docs API `replaceAllText`), checks that no `{{` is left, and exports the copy as PDF. HR sees that PDF.
4. **Send.** The server sends **that exact PDF** to Youtrust: it creates a signature request, uploads the document, adds the signers, places the signature fields and activates it. Then it stores the record (§4). Youtrust emails the first signer.

The filled Google Doc copy stays in the person's Drive folder as an editable trace of what was sent. *(Claude's call)*

**Signing order.** For `person + Quicksort`, the person signs first and Mohamed last, so Quicksort only signs what the other side has accepted. *(Claude's call)* Youtrust handles the order and emails Mohamed when it is his turn.

**Signature placement.** The builder picks how to place signature fields: Youtrust "smart anchors" (a text tag in the template) if the current API supports them, otherwise a fixed position on the last page. Templates should end with a signature block that works with that choice. *(left to the builder; document the convention for Mohamed)*

### 3. Following and filing

- **Webhook.** A new endpoint receives Youtrust's events. It verifies the signature header with the webhook secret, rejects anything unverified, and is idempotent by event ID.
- **Statuses** shown in the admin: `draft` (preview built, not sent), `sent`, `signed by person`, `completed`, `declined`, `expired`, `cancelled`, and `error` (the send failed; HR can retry).
- **Completion.** On the "done" event, the server downloads the signed PDF and the audit trail from Youtrust and files both in the person's registry, using the template's document type, through the existing documents pipeline (`apps/admin/server/documents/handler.ts`, `registerFile`). Filing is retried if it fails and is never done twice.
- **Replacing existing documents.** At send time, HR chooses which of the person's current documents of the same type the new one replaces, if any. The default is none for a first contract. For a corrected re-send, it's the earlier document from this flow. On completion, filing passes that choice as `supersedes` to `register_document`. Nothing is replaced automatically. *(Claude's call)*
- **Audit trail.** Filed as type `OTHER`, linked to the signed PDF with `parent_document_id`. *(Claude's call)*
- **New document type.** A migration adds a probation letter type (for example `PROBATION_LETTER`), because none exists today. *(Claude's call)*
- **Fallback.** A "Refresh" action on a row re-reads the status from Youtrust, in case a webhook was missed. *(Claude's call)*
- **Cancel.** HR can cancel a request that isn't complete. This cancels it in Youtrust too.

### 4. Data

A new table `signature_requests` (server-written, readable by admins only), one row per document sent:

- `person_id`, `template_id` (null for a custom PDF), the field values used (jsonb), signer names and emails, the order;
- the Youtrust signature request ID and document ID, the status and its timestamps;
- the Drive file IDs of the filled Doc copy and of the sent PDF, and the registry document IDs once filed;
- `created_by`, `created_at`, `updated_at`.

A `signature_templates` table holds the name, Doc ID, signers, document type and an active flag.

Settings (server-only, like `ai_settings`): the Youtrust API key and webhook secret (sandbox or production), and the Quicksort signatory's name and email. The admin settings page edits these, and the key is never sent to the browser.

### 5. Portal

- Remove the "My contracts" route and the "Waiting for your signature" card for employees (people with an open employment). Signed contracts appear in **Documents** through the registry.
- Candidates keep today's portal for now, until it's confirmed nothing still depends on the old `contracts` / `contract_signatures` flow. The builder checks whether any data uses these tables and reports back before removing anything.

## Constraints

- Youtrust's API is still documented under the Yousign name during the rename (base URL, `api.yousign.app/v3` as of 2025). The builder must check the current Youtrust API reference for URLs, request shape, webhook signing and sandbox before writing the client, and must not rely on memory.
- Use the existing Supabase, Clerk and Vercel function setup in `apps/admin/api` and `apps/admin/server`. Follow the existing command and authorization patterns. Only admins can send (`private.is_admin()`).
- Personal data (salary, address) goes to Youtrust, which is EU-hosted. Mention it in the GDPR register if one exists. *(note for Mohamed, not a build task)*
- No real contracts in tests or fixtures. Use a synthetic Doc and PDF, and mock Youtrust and Google in tests.

## Left to the builder

- Exact field-to-column mapping and formatting helpers.
- Signature placement method (anchors or coordinates).
- UI placement and layout within the person page and settings, using the existing `@quicksort-sas/ui` components.
- How to poll or retry filing and refreshing.
- Migration names and RLS details, following the existing migrations.
