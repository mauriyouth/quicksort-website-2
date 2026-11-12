# Hiring on a Youtrust signature, and dropping the old contract tables — design

Date: 2026-11-10 · Status: draft for approval · Builds on `2026-11-09-youtrust-contract-signing-design.md`

## Intent

Contracts are now signed through Youtrust. The old in-app signing (`contracts`, `contract_signatures`, `contract_countersignatures`) has never been used: production holds 0 rows in each. The **hire** step still depends on it, though. It refuses to hire unless the old tables hold a contract signed by the candidate and countersigned by HR. So today:

- the recruitment pipeline can't hire anyone through Youtrust, and
- the old tables can't be dropped without breaking hiring.

We want hiring to rely on the Youtrust signature, contracts to be sendable **before** hiring, and the old tables and their code to go away.

## Goals

- The **hire** prerequisite "signed contract" is met by a **completed Youtrust signature request** for that person.
- "Contracts & signatures" is available on a candidate's **application** (at the Contract stage), so the contract is sent and signed before hiring.
- Drop `contract_countersignatures`, `contract_signatures` and `contracts`, the `countersign_contract` command, the recruitment "Contracts" section, and the old portal and candidate-app contract pages.

## Non-goals

- Changing any other hire prerequisite (stage = Contract, accepted offer, no open employment).
- Changing the direct engagement path ("hired outside the pipeline"), which already skips contracts.
- Migrating data: there is none.

## Anti-goals

- Hiring someone whose contract was declined, expired, cancelled, or is still waiting for a signature.
- Hiring on a contract signed for an **earlier** application of the same person (a rehire must have a new contract).
- Breaking hiring for HR-role users, who can't read `signature_requests` (admins only).

## Decided (by Mohamed)

- Hiring requires the contract signed through Youtrust. Quicksort's signature in Youtrust replaces HR's in-app countersignature.
- "Contracts & signatures" appears on the application before hiring.
- The old tables are dropped.
- **The contract is linked to the application.** A contract sent from the application's section is tied to that application, and only that one counts for hiring.

## Design

### 1. Hire prerequisite

In `hr_application_requirements(app, 'hire')`, the `signatures` item becomes:

- label: **"The contract is signed in Youtrust"**
- done when a `signature_requests` row exists with:
  - `person_id` = the application's person;
  - `status = 'completed'` and `signed_document_id is not null` (filed);
  - `application_id` = this application. A new nullable column `signature_requests.application_id` references `hr_applications`. It is set only when the request is sent from the application's "Contract signature" section, so amendments and letters sent from the employment page never count. *(decided by Mohamed)*
- The requirement returns only done or not done, with no date. *(Claude's call)*

The `hire` branch of the HR command function uses the same check (it currently re-checks the old tables), and loses its `update public.contracts set employee_id…`. Both run as security definer, so HR-role users can hire without reading `signature_requests` directly.

### 2. Contracts before hiring

On the application view in the person workspace, the old **"Contracts"** section is replaced by **"Contract signature"**:

- **Admins:** the same `PersonSignatures` component used on the employment page, for this person. It lists requests and allows sending. Its "Send for signature" panel is the existing one.
- **HR-role users:** a read-only line saying whether the hire prerequisite is met ("Signed in Youtrust" or "Not signed yet. An admin sends the contract from this page."). This comes from the hire readiness list, which already reaches HR users through the requirements function.
- The `preview` action accepts an optional `applicationId`. The server checks that it belongs to the person and stores it on the request.

Template values come from `loadPersonFacts`. Before hiring there is no employment row, so the role, start date and salary come from the **accepted offer** when there is no employment. `loadPersonFacts` falls back to the person's latest accepted offer (`offers` via `hr_applications.person_id`) for `contract_type`, `salary_monthly`, `cjm` (as the daily rate for freelance) and the offer `title` (as the role). The start date stays empty for HR to type in. When there is no accepted offer yet, or a value is missing, those fields are simply empty, and the existing "fill in every field before sending" rule makes the admin type them. Sending is not gated on an offer. *(Claude's call)*

The section on the employment page stays as it is, for amendments and probation letters after hiring.

### 3. Dropping the old flow

A new migration:

- recreates `hr_application_requirements` and the HR command function without any reference to the old tables: no `countersign_contract` command, no `contract_id` lookup, and the new hire check;
- recreates the HR workspace payload function without `contracts`, `signatures` and `countersignatures`;
- first raises an exception and aborts if any of the three tables holds rows, so no environment silently loses data; *(Claude's call)*
- drops policies, then `contract_countersignatures`, `contract_signatures` and `contracts`;
- removes the `contracts` storage bucket's policies and, if it is empty, the bucket. If Supabase refuses to delete a bucket from SQL, the policies are dropped and the empty bucket is left in place, with a note.

Code removed: the recruitment "Contracts" section and its countersign form (`PersonWorkspace.tsx`), the `countersign_contract` command type and schema (`hr/domain.ts`, `hr/data.ts`), the workspace fields `contracts`, `signatures` and `countersignatures`, their types in `packages/hr-db` and `packages/candidate-db`, and the old contract pages in `apps/candidate`. The old migrations stay untouched, as history.

### 4. Candidate app

`apps/candidate` reads `contracts` and `contract_signatures` and would break once they're dropped. Its "My contracts" page, its "Waiting for your signature" card and its signing code are removed, in the same way as the admin portal. Candidates sign only through the Youtrust email, with no in-app replacement. *(Claude's call, required by the drop.)*

## Tests

- SQL:
  - hire succeeds with a completed, filed contract request linked to the application;
  - the drop migration aborts when an old table has rows;
  - hire fails for a request that is `sent`, `declined` or `cancelled`, for one filed for another person, for one linked to another application of the same person, and for one sent from the employment page (no application);
  - an HR-role user can hire when the prerequisite is met;
  - the old tables no longer exist.
- Existing `hr-lifecycle.sql` hire scenarios are updated to create a completed signature request instead of contract signatures.
- Browser:
  - the application view shows "Contract signature" to an admin, and the read-only status to HR;
  - the hire readiness shows the new label.

## Left to the builder

The migration name must sort after `20261221090200`. The exact recreation of the large HR command function (copy the latest version, change only the contract parts), UI placement within the application view, and test fixtures.
