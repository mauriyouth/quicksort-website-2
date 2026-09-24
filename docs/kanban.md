# Kanban workspace

Both portals expose **Kanban boards** at `/kanban`. The implementation is shared in `packages/candidate-ui/src/KanbanWorkspace.tsx` and follows the portal's existing theme.

## Permissions and behavior

- Admins can see every project and board, create projects and boards, add named columns, and grant/revoke access for existing workspace profiles.
- A project grant includes every current and future board in that project. A board grant includes only that board; its parent project is visible for navigation, but sibling boards remain hidden.
- Candidates can view accessible boards, create cards, and move any card within those boards. They cannot change project/board/column structure, edit card content, delete cards, or grant access.
- Removing a project grant preserves any direct board grants. Removing a board grant does not cancel project-level access. The access panel describes this explicitly.
- Board creation preselects To do, In progress, Blocked, and Done. Admins can uncheck defaults, rename selected columns, and add custom columns. At least one uniquely named column is required. **Edit Kanban board** renames the board and its columns or adds columns in one atomic save. Column IDs stay unchanged, preserving cards and references. Both portals read these names from the same records; candidate views refresh on focus, manually, or within 30 seconds.
- Card creators are stamped in the database with the authenticated profile ID and a display-name snapshot (email fallback). The browser cannot supply or change this attribution.
- Drag cards between columns to move them. Cards do not show a movement dropdown. Changes are saved before being shown as complete. The workspace refreshes on focus and every 30 seconds.
- Admins can delete a project or board after typing its exact name (case and spaces must match). The confirmation explains deletion of contained boards, columns, cards, and access grants, and the one-step undo option. Candidates cannot delete projects or boards.
- This scope does not include editing projects, deleting individual columns, or editing cards, card assignment, comments, attachments, or within-column ordering.

## Database rollout

For a fresh environment, apply the new Kanban workspace and admin deletion migrations in timestamp order to the correct portal database before deploying the admin and candidate apps. It creates six RLS-protected tables, private identity/admin helpers, and card/board triggers. No existing data is modified. This migration is already applied to production; do not replay it there. The local filename matches the recorded remote migration version.

The existing application calls `public.sync_clerk_profile()` to map Clerk sessions to UUID profiles. Kanban uses the read-only `private.current_user_id()` lookup used by the live portal’s RLS policies and falls back to `auth.uid()` for legacy Supabase Auth installations. It reads administrative authorization from `public.user_roles`, never user metadata. Confirm the bridge resolves the same profile ID as the portal session in the target environment before release; the repository does not contain the Clerk bridge's migration.

The migration was applied successfully to Supabase project `kupbvrnjppcwqxmzxasi` on 2026-09-24. All six tables have RLS and their expected policies. The live identity lookup was inspected before applying the migration. Vercel authentication succeeded with access to Mohamed Ahmednah’s projects. Admin deployment `dpl_B2fgpLNrsNtPtoo6sriK4ng4rZtf` is READY at `https://admin.quicksort.fr`. The candidate release uses the complete live gallery manifest: 14 people and 28 private JPEGs. All 28 files were restored from the existing production deployment with user approval and verified against Vercel’s SHA-1 file identifiers. They remain Git-ignored and are bundled only into the authenticated photo function.

GitHub `origin/main` was fetched and pulled before integrating the Kanban work; it was already up to date at `90094f6`. Merge the tested feature branch before the final production redeploys.

## Verification

- `pnpm test` runs the PostgreSQL permission tests in PGlite as well as the existing unit tests. The Kanban suite exercises RLS under actual PostgreSQL roles, default columns, creator stamping, forgery protection, candidate restrictions, cross-board movement rejection, inherited access (including future boards), outsiders, revoked access, anonymous denial, admin parent deletion, candidate deletion denial, and cascading cleanup that preserves unrelated projects and boards.
- The test database supplies an identity-bridge fixture. It does not validate live Clerk token configuration, PostgREST behavior, or the deployed identity bridge. Smoke-test with a real admin and two candidates after applying the migration in the target environment.
- `pnpm --filter @quicksort/admin build` and `pnpm --filter @quicksort/candidate build` pass. Builds were also verified with synthetic Clerk/Supabase environment values so Vite includes the authenticated application code; deploy with the real environment configuration, not the fixture values.
- Browser fixture checks covered project/board/column/card creation, access grant/revoke, candidate controls, dropdown and drag movement, and 375px/1440px layouts.

For a reproducible local visual fixture, run `node tests/kanban-preview/server.mjs`, then open `http://127.0.0.1:5176/` for admin controls or append `?candidate` for candidate controls. This server uses synthetic in-memory API responses, does not model access filtering, and is not a production entry point or an authentication bypass. Database access enforcement is tested separately by the PostgreSQL suite. Restarting the fixture resets its data.

## Admin deletion rollout

Apply `supabase/migrations/20260924213447_kanban_admin_deletion.sql` before deploying the updated admin UI. This grants parent-table DELETE only through admin RLS policies; existing foreign keys cascade child deletion atomically. No existing records are deleted by the migration.

Deletion validation: database tests and portal type checks pass. Browser fixture checks verified exact-name matching for boards/projects, case and trailing-space mismatches, cancellation, and absence of deletion controls for candidates. The deletion migration was applied to production with user approval; both admin-only DELETE policies were verified.

## Magic design

Only admins have a small **Magic design** button beside the board actions. It opens a keyboard-accessible modal for instructions (up to 6,000 characters). Vercel AI SDK generates 1–20 card drafts using the requested language, count, content, and existing board columns. Users can edit titles, descriptions, and columns or remove drafts before adding them in one batch. Escape or the close button cancels generation; saving holds the dialog open until complete.

The admin API checks the caller's session, admin role, and board access using the existing RLS policies before calling the model. Only the prompt, board name, and columns are sent to the provider. Generated column IDs and card lengths are validated. Cards are saved using the caller's database session, preserving creator attribution and permissions. No database migration is required.

Magic design reuses Settings → AI configuration (including its environment fallback). Only the admin project exposes `/api/generate-cards`; candidates have no AI endpoint and cannot call the admin endpoint. Candidates can still create cards manually. No candidate AI key is needed. Use Vercel's local development environment for real API calls, since plain Vite serves only the frontend.

## Board editing rollout

Apply `supabase/migrations/20260924215546_kanban_board_editing.sql` before deploying these UI changes. It adds an admin-only, RLS-enforced atomic save function and name-update permissions. Existing boards and cards are preserved. The creation function replaces legacy default columns within its transaction. Candidate structure edits remain forbidden. This migration was applied to production project `kupbvrnjppcwqxmzxasi` on 2026-09-24. Its invoker security, anonymous denial, and admin-only update policies were verified. Local database tests, both portal builds, and browser checks passed.

## Card deletion

Admins see a small trash button on each card. Its confirmation dialog requires the exact word `delete` before enabling deletion. Candidates do not see the button; the `cards_delete` database policy restricts DELETE to `private.kanban_admin()`. Apply `20260924220030_kanban_admin_card_deletion.sql` before deploying this UI. The migration does not delete existing data.


## One-step undo and redo

Command Z on Mac, Control Z on Windows/Linux, or the Undo button reverses the latest successful saved action while the workspace is open. This covers project/board/card creation and deletion, board/column renames and additions, card details and moves, access grants/revocations, and a Magic design batch as one action. Command Shift Z / Control Shift Z or the Redo button reapplies the action after undo. Users can alternate undo and redo; the next successful change replaces this history and clears redo. Text fields retain native text undo and redo. Refreshing the page clears the UI's undo offer.

Apply `20260924222257_kanban_undo.sql` before deploying the updated portals. It records only the latest transaction per identity and verified portal origin in private tables. Undo accepts a server-generated token, never client-supplied restoration rows. Restoring deletions retains original IDs, attribution, dates, contents, and grants. Current permissions are checked again. Changed rows or new descendants cause an atomic refusal so subsequent work is preserved. Database table locks serialize the brief restoration transaction with other writes. The migration adds no historical recovery for actions taken before it is applied.

Validation includes PostgreSQL permission/conflict tests and shortcut tests, alongside portal type checks. The undo/redo migration was applied to production project `kupbvrnjppcwqxmzxasi` on 2026-09-24. Private history tables deny direct client access; anonymous execution is denied for all history functions.
