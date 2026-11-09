# Supabase and deployment setup

## Connected database

The active admin checkout and linked CLI project use `ctgtowqjswbxwiapcvfj`, URL `https://ctgtowqjswbxwiapcvfj.supabase.co`. Check each application's environment before applying changes; the marketing deployment may use a different project.

The HR lifecycle migration `20261014090000_hr_lifecycle.sql` was applied on October 4, 2026. Deployed migration files remain in the repository. Apply pending changes with `pnpm exec supabase db push --linked`; do not replay already-applied files or reset the linked database.

The HR workspace uses `hr_people`, `hr_applications`, employment periods in `employees`, transactional `hr_command` writes, and the scoped `hr_workspace_snapshot` read. Candidate-facing views are `my_applications`, `my_application_events`, `my_employment`, `my_onboarding_items`, and `my_offers`. Portal account links are explicit.

The prior directory tables and views are retained in the restricted `hr_legacy_20261014` schema. All 24 people were preserved. The 23 original employee rows remain archived; 22 dated employment periods are available in the new workspace. One employee needs their actual start date recorded before an employment period can be created. Their person record contains a review note. No hiring, signature, account-link, or date evidence was invented during conversion.

Private storage buckets `candidate-documents` and `contracts` remain in place, both limited to 10 MB per file. Onboarding files support PDF, JPG, PNG and DOCX; contracts support PDF. Self-folder policies on `candidate-documents` accept either identity key from the verified JWT — the workspace user uuid (`user_metadata.user_id` claim) or the raw `sub` (Clerk user id), which is what the browser apps use as the upload folder prefix.

All exposed tables use row-level security. Candidates are restricted to their own records. Admin roles are stored in `user_roles`, which clients can read but cannot change. Every new user starts as a candidate, irrespective of user-supplied metadata. No service-role/secret key is used in an application bundle.

## First admin

1. Open the admin app and choose **Create an account**. Use your intended admin email and confirm the email from Supabase.
2. A database owner runs this in Supabase SQL Editor, replacing the email:

```sql
update public.user_roles
set role = 'admin'
where user_id = (
  select id from auth.users
  where lower(email) = lower('YOUR_ADMIN_EMAIL')
    and email_confirmed_at is not null
)
returning user_id, role;
```

3. Refresh the admin app. Until the role is granted, the app displays an access-pending screen and the database rejects administrative operations.

No initial administrator has been selected yet. Do not use user metadata to grant privileges. Granting/revoking roles remains a trusted database-owner operation.

## Environment variables

Each portal needs a local `.env.local` (never committed) built from its `.env.example`:

- `VITE_SUPABASE_URL` — project URL, e.g. `https://kupbvrnjppcwqxmzxasi.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` — the public anon/publishable key (Supabase Dashboard → Project Settings → API)
- `VITE_CLERK_PUBLISHABLE_KEY` — the Clerk publishable key for the `blessed-midge-8591` instance (Clerk Dashboard → API keys)

Without `VITE_CLERK_PUBLISHABLE_KEY` the app stops at startup with a "Sign-in is not configured" message naming the missing variable; without the Supabase variables the workspace shows "coming online" after sign-in.

## Auth configuration

In Supabase Authentication, keep Email/password enabled. Set the Site URL to `https://quicksort-admin.vercel.app`. Add the exact following redirect URLs for the deployed portal and local development:

- `https://quicksort-admin.vercel.app/`
- `https://quicksort-admin.vercel.app/?account=password`
- `http://127.0.0.1:5174/` and `http://127.0.0.1:5174/?account=password`

(The retired HR portal URLs can stay listed until the old deployment is taken down.)

Use custom SMTP for production delivery of confirmation and password-reset messages. Configure the Auth password minimum to 12 characters to match the UI. The apps support signup, confirmation, password login, recovery, password creation after an invitation/recovery session and sign-out. They do not send admin invitations themselves.

The live redirect/SMTP settings must be configured for the final portal domains; migrations do not change those project settings.

## Vercel

The admin Vercel project lives in team `team_msiIWIErbrbRMcWEWv69WUdJ`:

- Quicksort OS (admin): https://os.quicksort.fr (also https://quicksort-admin.vercel.app)

The former HR portal app (`apps/hr`, package `@quicksort/hr`) was merged into the admin app: one deployment serves both workspaces. Signed-in users with the `admin` role get the back-office (HR, Sales, Ops sections); every other signed-in user gets the candidate self-service portal (application status, documents, contracts, tool access, team photos). The app root picks the shell from the session role — data access stays enforced by Supabase RLS. The standalone `quicksort-hr` Vercel project can be retired (or kept as a duplicate of the same root) once the domain is repointed.

The Vercel account could not connect the GitHub repository to these new projects because its GitHub integration is missing. A repository owner must connect `mauriyouth/quicksort-website-2` in each project's Git settings to enable automatic deployments. The source is already pushed to `feat/workforce-monorepo` in that repository.

The public marketing website is no longer part of this repository. Enable source files outside each Root Directory so workspace dependencies can be bundled. Use automatic pnpm workspace installation from the committed lockfile.

| Project | Root Directory | Build command | Output |
| --- | --- | --- | --- |
| `quicksort-admin` (staff + candidate portal) | `apps/admin` | `pnpm build` | `dist` |

Each Vercel project has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured for production, preview and development. Use the public publishable key, never a secret/service-role key. Environment changes require a new Vite build.

The admin project also needs these server-only variables for the Qonto bank sync (never prefix them with `VITE_`):

- `CRON_SECRET`: bearer Vercel cron sends to `/api/bank-transactions-cron`.
- `SUPABASE_SERVICE_ROLE_KEY`: used only by that cron, which has no caller identity (without it the cron returns 503).
- `MOONSHOT_API_KEY`: optional fallback for the Kimi classifier; the key is normally saved in Settings → Transaction classification.

Deploy order: apply `supabase/migrations/20261207090000_bank_transactions.sql` (`pnpm exec supabase db push --linked`) before deploying the admin app that uses it.

The portals use SPA rewrites and no-index headers.

Domain: `os.quicksort.fr` (Quicksort OS). Add it to the Clerk instance's allowed origins, and apply `supabase/migrations/20261220090000_kanban_admin_os_origin.sql` so Kanban admin rights keep working from the new origin. Domain DNS changes and external tool provisioning are not part of the app code.

## Verification

- `pnpm build`: builds both apps; the admin build includes strict TypeScript checking.
- `pnpm test`: URL and upload boundary checks.
- `pnpm test:browser`: mocked browser workflows and responsive layouts.
- `supabase/tests/access.sql`: transaction-scoped authorization fixtures. Run using SQL Editor/a write-capable connection; the connector's read-only SQL method cannot execute these fixtures. All inserted fixtures are rolled back.

The verification migration performs the same access assertions inside an exception subtransaction, rolling back its fixtures on success and failing the migration on any failed assertion. The production security advisor reported no findings after schema setup.
