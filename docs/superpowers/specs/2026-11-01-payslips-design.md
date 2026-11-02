# Payslips — design

Date: 2026-11-01 · Status: draft for approval

## Intent

Payroll is run in Silae (my.silae.fr). Silae already distributes each payslip to the employee by email. Quicksort keeps no copy of its own, so finding a payslip means digging through Silae.

We want every payslip filed in the employee's HR Drive folder and visible in two places: on the person's HR page in the admin, and in the employee's own portal (their own payslips only). Getting them in should take a minute a month: download from Silae, drop into the admin, confirm, done.

## Goals

- A monthly import that takes Silae's downloaded payslips (a zip or loose PDFs), matches each one to an employee and files it in that person's Drive folder as a registered document.
- A **Payslips** section on each person's HR page that lists payslips by month, with open and download.
- A **My payslips** list in the employee portal showing only their own payslips.
- The employee **matricule** aligned with the Silae employee number, so matching is by number and not by name.

## Non-goals

- Logging into Silae automatically, scraping my.silae.fr, or storing Silae credentials. Silae's SWS API returns payslip *data* but has no documented PDF download, and a scripted login would break on 2FA or a redesign.
- Emailing or notifying employees. Silae keeps doing distribution.
- Reading or analysing salary figures. The only things read from the PDF are the matricule and the period.
- Freelancers. They get no payslip.

## Anti-goals (failures even if it "works")

- **A payslip filed under the wrong person.** Payslips carry salary, the Social Security number and the IBAN. The import must never file a file silently on a weak match: anything other than a confident matricule match needs a human to confirm.
- An employee seeing anyone else's payslip in the portal.
- Payslips landing anywhere other than the HR (people) Drive root, which is deliberately kept separate from the client contracts root.
- Duplicates when the same month is imported twice.

## What we know about Silae's output (verified 2026-11-01)

- my.silae.fr → Documents → Payslips lists every payslip with period, employee name, **employee number** (e.g. `00026`), file name and a distribution status. Rows can be selected in bulk and downloaded with one button. *Unverified:* that a multi-select download comes as a zip. The import should accept both a zip and several PDFs.
- File name pattern: `NOM_PRENOM[_MORE]_MM_YYYY_n.pdf`, e.g. `HAMMOUD_ISSA_10_2026_1.pdf`, `ADOTRI_FRIMPONG_MALCOM_MICHEL-ANGE_10_2026_1.pdf`. `n` is the payslip number within the period; `_2` means a second payslip for the same month, e.g. a correction or final pay.
- The PDF has an extractable text layer (embedded TrueType fonts, not a scan). Using pdfjs-dist, page 1 contains a label block `Matricule : | N° SS : | Iban / Rib : | …` followed by the values in the same order. On the sample, the matricule value `00026` came right before the SS number. Silae shows the same number in its list. The period also appears in the file name, and the PDF should show it too (the builder should verify where).
- A sample file was inspected locally and is not committed. The builder needs a real Silae payslip to write the parser and tests against, and must **not** commit real payslips. Fixtures should be synthetic or redacted.

## Decided

### Matricule (decided by Mohamed)

- Today `employees.matricule` is auto-assigned `QS-0001…`, `not null unique`, and not editable (migration `20261103090000_employee_matricule.sql`).
- It becomes **editable by HR**. For salaried employees it holds the Silae number (`00027`). Freelancers and anyone not yet in Silae keep their `QS-` value. The `QS-` default stays for new rows.
- Uniqueness is **across people**, not across rows. One person can have several `employees` rows (rehires, imported history), and Silae may keep the same number for them. Several rows of the **same** person may share a Silae number; two different people may not. The `QS-` defaults stay unique. *(Claude's call)*
- When the import sets a Silae number, it goes on the person's **open** employment row, or their latest row if none is open. Matching looks across **all** rows, ended ones included, so older months still match after someone has left. A payslip resolves to the **person**. *(Claude's call)*
- Backfilling existing employees happens through the first import (below), not through a separate migration.

### Import flow

1. HR opens a **Payslips** page under the HR nav (`/hr/payslips`; placement is Claude's call) and drops a zip or PDFs.
2. For each PDF, the admin extracts the **matricule** and the **period** (month/year) from the PDF text, plus the index `n` from the file name.
3. Matching:
   - **✓ Matched:** an employee whose matricule equals the extracted number.
   - **? Confirm:** no matricule match, but a name match from the file name (normalised: case, accents, hyphens, word order). Confirming files the payslip **and writes the Silae number into that employee's matricule**, so next month it matches by number.
   - **✗ Unknown:** no match. HR picks the employee by hand (which also sets the matricule) or skips the file.
   - **Unreadable:** no matricule or period can be extracted. It's shown as an error and nothing is filed.
   - **Number and name disagree:** the matricule matches employee A but the file name's name is clearly someone else. This drops to **? Confirm** and shows both names; it never files automatically. *(Claude's call)*
   - **Overwriting a Silae number:** if a Confirm or Unknown pick targets an employee who already has a different non-`QS-` number, the review row shows a warning with both numbers and needs an explicit confirmation. It's never overwritten silently. *(Claude's call)*
   - Every Confirm or Unknown row shows the name **as printed in the PDF / file name** next to the chosen employee, so HR compares like with like.
4. A review list shows file → employee → period → status before anything is written. One action files every confirmed row.
5. Re-importing is idempotent. The same person + period + `n` with the **same content** (`sha256`) is shown as "already filed" and skipped. The same person + period + `n` with **different content** is shown as "changed — replaces the filed payslip". When HR confirms, the new file is registered and the old one marked `superseded`, using the registry's existing supersede mechanism. A different `n` in the same period is a separate payslip. *(Claude's call)*
6. Older months can be imported the same way (backfill).

### Filing

- New document type **"Bulletin de paie"** (code e.g. `PAYSLIP`; owner kind `person`; no expiry; `sensitive = true`). It must not be added to `required_for`, so it never shows up as a missing document.
- Drive location: `<people root>/<NOM Prénom> – <id>/08_Bulletins_de_paie/<YYYY>/`. This adds a `08_Bulletins_de_paie` folder label, and the year subfolder comes from the payslip **period**, not the upload date. The pattern follows `FOLDER_LABELS` / `YEARLY_SUBFOLDERS` in `apps/admin/server/documents/folders.ts`; the folder name is Claude's call.
- Each payslip is registered in `documents` like any other person document, with the period stored so it can be listed and deduplicated by month. How the period is stored (e.g. `valid_from` = first day of the month, or a dedicated column) is up to the builder.

### Viewing

- **Admin:** a Payslips section on the person's HR page (`apps/admin/src/hr/PersonWorkspace.tsx`), newest month first, with open/preview and download. It's visible to **everyone who can see that person's HR page today** (decided by Mohamed), with no narrower role. Downloads go through the existing document download proxy, which already logs access to sensitive person documents.
- **Payslips stay out of the generic Documents list on the person page.** Mixing dozens of monthly files into the identity and contract checklist would bury it. This is Claude's call.
- **Portal:** a "My payslips" tab in `apps/admin/src/portal/HrPortal.tsx` lists the signed-in employee's own payslips, visible as soon as they're imported (Claude's call: don't wait for Silae's "Distributed" status, which isn't in the file anyway). Today employees can't read the `documents` registry at all: RLS is `private.can_manage_document`, which is staff only. So this needs a **self-only** read path and a self-only download, scoped by the signed-in person, and limited to the payslip type. The builder chooses the mechanism (view, RPC, or an API action), but it must be impossible to reach another person's payslip or any other document type through it.
- **People who have left keep access** (decided by Mohamed). "My payslips" is scoped by the linked portal account (`hr_person_accounts`) only, not by an open employment. Offboarding must not unlink the portal account. Leavers still see their payslips, and only those.

## Constraints

- Follow the existing document registry and the storage abstraction (`apps/admin/server/documents/*`, `apps/admin/src/documents/client.ts`). Don't build a parallel file store.
- PDF text extraction runs **in the browser** (changed while planning). The registry already sends file bytes from the browser straight to Drive, and the serverless request limit (about 4.5 MB) can't take a month of payslips. Every filing still goes through `register_document` under RLS. pdfjs-dist worked on the sample.
- Uploaded files are untrusted input: limit size and count, accept only PDFs (and PDFs inside a zip), and guard against zip-slip and zip bombs.
- Documents are never deleted (existing rule). The `documents_guard` trigger forbids changing a document's owner, so reassignment doesn't exist today. Payslips get a **"Move to another person"** action in the admin. It moves the Drive file into the right person's `08_Bulletins_de_paie/<year>/` folder, registers it under that person, and archives the old record, all with an audit trail. It's never a delete. It also offers to reset the wrong person's matricule (back to their previous value, kept from before the import changed it), so the mistake doesn't come back next month as a confident match. *(Claude's call)*

## Left to the builder

- The exact UI of the import page and the review list, following the admin's existing HR styling.
- Where parsing happens (an API action on the documents handler vs. a new endpoint) and whether files upload to Drive straight from the browser (the existing `prepare-upload` pattern) or through the server.
- The parser details and its tests (using redacted or synthetic fixtures).
- Whether "Unknown" rows can create a new employee. Default: no, pick an existing one or skip.
