# Hire on Youtrust Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiring requires a completed Youtrust contract linked to the application. Contracts can be sent from the application before hiring. The old in-app contract tables and their code are removed.

**Architecture:** One migration adds `signature_requests.application_id`, recreates the three SQL functions that mention the old tables (copied from their latest versions, with only the contract parts changed), and drops the old tables behind a row-count guard. The signatures API learns an optional `applicationId`, and `loadPersonFacts` falls back to the accepted offer. The application view swaps its old "Contracts" section for the existing `PersonSignatures` component. Old UI, types and the candidate app's contract pages are deleted.

**Tech Stack:** Postgres/Supabase migrations, TypeScript, React, `node --test`, psql SQL tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-hire-on-youtrust-signature-design.md` (builds on `docs/superpowers/specs/2026-11-09-youtrust-contract-signing-design.md`)

## Global Constraints

- Hire requirement label, exactly: `The contract is signed in Youtrust`.
- Requirement done ⇔ a `signature_requests` row exists with `application_id = app`, `person_id` = the application's person, `status = 'completed'`, `signed_document_id is not null`, and `type_code in ('EMPLOYMENT_CONTRACT','FREELANCE_CONTRACT')`.
- `application_id` is set only by sends from the application section; sends from the employment page leave it null.
- The drop migration raises `Old contract tables are not empty; aborting.` if any of `contracts`, `contract_signatures`, `contract_countersignatures` has rows.
- Recreated SQL functions are copied from their **latest** definitions, changing only contract-related lines:
  - `hr_application_requirements` and `hr_command`: `supabase/migrations/20261121100000_employee_nationality.sql`;
  - `hr_workspace_snapshot`: `supabase/migrations/20261109090000_employee_salaries.sql`.
  - Before copying, re-check with `git grep -l "function public.<name>" supabase/migrations | tail -1`.
- New migration file: `supabase/migrations/20261221090300_hire_on_youtrust_signature.sql`.
- Only admins send. HR-role users see the requirement status read-only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A rehire, or a second application of the same person,** must not be hireable on the first application's contract. Test: a completed request linked to application A doesn't satisfy hire for application B (Task 1).
2. **An HR-role user hiring** must still work when the requirement is met, because the functions are security definer. Test it in Task 1.
3. **`preview` with an `applicationId` belonging to another person** must be refused (400 `Application does not belong to this person.`). Test it in Task 2.
4. **A candidate with no accepted offer** must still be able to prepare a send: the fields come back empty and `known: false`, with no crash. Test it in Task 2.
5. **The old recruitment "Contracts" UI** must be fully gone, and the workspace snapshot parse must not fail on the missing keys. The admin Playwright HR workspace load is covered in Task 3.

---

### Task 1: Database

**Files:**
- Create: `supabase/migrations/20261221090300_hire_on_youtrust_signature.sql`
- Modify: `tests/hr-lifecycle.sql` (hire scenarios: replace the contract and signature inserts with a completed, linked `signature_requests` row; remove countersign scenarios), `tests/documents.sql` (remove the old-table inserts at ~159-168 and their assertions, keeping the rest), `tests/signatures.sql` (new assertions below), `packages/hr-db/src/database.types.ts` (remove `contracts`, `contract_signatures` and `contract_countersignatures` table types and their row types; add `application_id: string | null` to the signature request row), `packages/candidate-db/src/database.types.ts` (remove `contracts` and `contract_signatures`)

**Interfaces:**
- Produces:
  - column `signature_requests.application_id uuid null references public.hr_applications(id)`, plus an index on it;
  - `hr_application_requirements(app, 'hire')`, whose `signatures` key now carries the new label and rule;
  - `hr_command`: no `countersign_contract` kind, no `contract_id` key, and the hire check uses the same rule;
  - `hr_workspace_snapshot()`: no `contracts`, `signatures` or `countersignatures` keys.

- [ ] **Step 1: Write the failing SQL assertions** in `tests/signatures.sql`, run as admin unless stated:
  - hire succeeds after inserting a `completed` request with `signed_document_id` set, `type_code 'EMPLOYMENT_CONTRACT'` and `application_id` = the app;
  - hire raises `Hire prerequisites: The contract is signed in Youtrust` when the only request is:
    - `sent`;
    - completed but linked to another application of the same person;
    - completed with `application_id` null;
    - completed for another person;
  - an `hr`-role user can hire when the requirement is met;
  - `to_regclass('public.contracts') is null`, and the same for the two other tables;
  - `hr_workspace_snapshot()` has no `contracts` key.
- [ ] **Step 2: Run `pnpm test:hr-db`.** Expected: FAIL.
- [ ] **Step 3: Write the migration.**
  1. The guard.
  2. Add the column and index.
  3. `create or replace` the three functions (Global Constraints), changing only the contract parts.
  4. Drop the `contracts` storage policies.
  5. Drop the three tables in dependency order: countersignatures, signatures, contracts.
  6. `delete from storage.buckets where id = 'contracts'` inside `begin … exception when others then raise notice …`, so a refusal leaves the empty bucket in place.
- [ ] **Step 4: Update `tests/hr-lifecycle.sql` and `tests/documents.sql`** so they no longer use the old tables, and update both `database.types.ts` files. Run `pnpm test:hr-db` and `pnpm typecheck`. Expected: PASS. The typecheck may fail in the files Tasks 3 and 4 clean up. If so, note the errors and leave those files to their tasks; don't fix them here.
- [ ] **Step 5: Commit** (`feat(hr): hire on a Youtrust signature; drop old contract tables`).

### Task 2: Signatures API

**Files:**
- Modify: `apps/admin/api/signatures.ts` (`preview` accepts `applicationId?: uuid` for both the template and custom variants; checks that `hr_applications.person_id = personId`, otherwise 400 `Application does not belong to this person.`; stores it on the inserted request), `apps/admin/server/signatures/fields.ts` (`loadPersonFacts` fallback)
- Test: `tests/signatures-api.test.mjs`, `tests/signature-fields.test.mjs`

**Interfaces:**
- Consumes: the Task 1 column `signature_requests.application_id`.
- Produces:
  - `preview` input gains `applicationId?: string`;
  - `list-requests` rows include `application_id`;
  - `loadPersonFacts(client, personId)` is unchanged in signature, but when the person has no employment row it fills `contractType`, `salaryMonthly`, `dailyRate` (from the offer's `cjm` when `contract_type = 'Freelance'`) and `role` (the offer `title`) from the person's latest `accepted` offer through `hr_applications.person_id`, and leaves `startDate` null.

- [ ] **Step 1: Write failing tests:**
  - preview with a matching `applicationId` stores it;
  - preview with another person's application gets 400 with the exact message, and nothing is inserted;
  - `loadPersonFacts` for a candidate with an accepted CDI offer returns the offer salary and title, with `startDate` null;
  - with an accepted Freelance offer, it returns `dailyRate` = cjm and `salaryMonthly` null;
  - with no offer, everything is null or empty, and `knownValues` gives `""` for those fields.
- [ ] **Step 2: Run `pnpm test`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(signatures): send contracts from an application`).

### Task 3: Admin HR workspace

**Files:**
- Modify:
  - `apps/admin/src/signatures/PersonSignatures.tsx`: optional prop `applicationId?: string`, passed to `preview`. When set, the list shows only requests with that `application_id`, and the section copy reads "The hiring contract for this application. Once signed in Youtrust, the person can be hired."
  - `apps/admin/src/hr/PersonWorkspace.tsx`: replace the application's `<Section title="Contracts" …>` with `<Section title="Contract signature">`. Admins (`workspace.capabilities.admin`) get `<PersonSignatures personId=… person=… applicationId={application.id} />`. Others get a read-only line from the hire readiness item `signatures`: "Signed in Youtrust" when done, otherwise "Not signed yet. An admin sends the contract from this page." Remove the `contracts`, `signatures` and `countersignatures` usages, including the `Readiness` key.
  - `apps/admin/src/hr/domain.ts`: remove the `countersign_contract` command and the workspace fields.
  - `apps/admin/src/hr/data.ts`: remove `contractSchema`, `signatureSchema`, `countersignatureSchema`, the snapshot keys and `countersign_contract`.
- Test: `tests/hr-workspace.spec.ts` (extend; mock as the file does)

**Interfaces:**
- Consumes: Task 2's `preview` with `applicationId`, and Task 1's snapshot without the contract keys.

- [ ] **Step 1: Write failing Playwright tests:**
  - an admin opening an application at the Contract stage sees "Contract signature" and a "Send for signature" button;
  - an hr-role user sees "Not signed yet. An admin sends the contract from this page." and no send button;
  - the hire readiness shows "The contract is signed in Youtrust";
  - no "Countersign as employer" anywhere.
- [ ] **Step 2: Run them** with a scratch Playwright config without the missing `@quicksort/web` webServer, kept outside the repo or git-ignored. Expected: FAIL. Note any hr-workspace.spec.ts failures that already happen before your change.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the specs and `pnpm typecheck`.** Expected: the new tests PASS, with no new failures.
- [ ] **Step 5: Commit** (`feat(hr): send the hiring contract from the application`).

### Task 4: Portals

**Files:**
- Modify:
  - `apps/admin/src/portal/HrPortal.tsx`: remove the `contracts` nav entry, route and page, the `contracts`/`contract_signatures` state and loading, `openReview`, `sign`, `SignForm`, the review and preview state, and the now-unused imports. "No application linked yet" copy: "Your HR team can link your account to your person record. Your documents are already available."
  - `tests/portal.spec.ts`: the pre-hire test asserts there's no "My contracts" and `/contracts` shows "Page not found"; drop `contracts`/`contract_signatures` from the fixture tables.
  - `apps/candidate/src/App.tsx`: remove the "My contracts" nav entry, page, "Waiting for your signature" card, review and sign code, and the loading of both tables.
  - `README.md:47`: replace "contracts with typed e-signature" with "contracts signed through Youtrust (sent by HR)".

- [ ] **Step 1: Update `tests/portal.spec.ts`** as above, and run the two portal contract tests with the scratch config. Expected: FAIL on the pre-hire one.
- [ ] **Step 2: Implement** the HrPortal and candidate-app removals.
- [ ] **Step 3: Run `pnpm typecheck`** (both apps) and the portal spec. Expected: typecheck clean, and the contract tests PASS. Other portal.spec.ts failures that already existed are unchanged.
- [ ] **Step 4: Commit** (`feat(portal): remove in-app contract signing everywhere`).
