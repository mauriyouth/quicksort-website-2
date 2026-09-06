# Supabase and deployment setup

## Connected database

Project: `kupbvrnjppcwqxmzxasi` (Quicksort), URL `https://kupbvrnjppcwqxmzxasi.supabase.co`.
The versioned migrations have already been applied to this project. Do not replay them manually on the same database. Generated TypeScript definitions in `packages/db/src/database.types.ts` came from this project's schema.

Tables: `profiles`, `user_roles`, `jobs`, `candidate_documents`, `contracts`, `contract_signatures`, `tool_requests`.
Private storage buckets: `candidate-documents` and `contracts`, both limited to 10 MB per file. Onboarding files support PDF, JPG, PNG and DOCX; contracts support PDF.

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

## Auth configuration

In Supabase Authentication, keep Email/password enabled. Set the Site URL to the candidate portal's final HTTPS origin. Add the exact following redirect URLs for both deployed portals and local development:

- `https://ADMIN_HOST/`
- `https://ADMIN_HOST/?account=password`
- `https://CANDIDATE_HOST/`
- `https://CANDIDATE_HOST/?account=password`
- `http://127.0.0.1:5174/` and `http://127.0.0.1:5174/?account=password`
- `http://127.0.0.1:5175/` and `http://127.0.0.1:5175/?account=password`

Use custom SMTP for production delivery of confirmation and password-reset messages. Configure the Auth password minimum to 12 characters to match the UI. The apps support signup, confirmation, password login, recovery, password creation after an invitation/recovery session and sign-out. They do not send admin invitations themselves.

The live redirect/SMTP settings must be configured for the final portal domains; migrations do not change those project settings.

## Vercel

Import `mauriyouth/quicksort-website-2` into three Vercel projects. Enable source files outside each Root Directory so workspace dependencies can be bundled. Use automatic pnpm workspace installation from the committed lockfile.

| Project | Root Directory | Build command | Output |
| --- | --- | --- | --- |
| Existing `quicksort-website-2` | `apps/web` | `pnpm build` | `dist` |
| `quicksort-admin` | `apps/admin` | `pnpm build` | `dist` |
| `quicksort-candidate` | `apps/candidate` | `pnpm build` | `dist` |

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` on all three projects for the intended environments. Use the public publishable key, never a secret/service-role key. Environment changes require a new Vite build.

Coordinate changing the existing website Root Directory with merging the monorepo commit. The old website revision cannot build from `apps/web`, and the monorepo revision should not build as the old root app. The local `.vercel` website link lives in `apps/web/.vercel`.

The portals use SPA rewrites and no-index headers. The website has narrow rewrites for `/career/:slug` and `/fr/career/:slug`, retaining 404 responses for unrelated unknown routes. Job detail pages return an app shell and mark unavailable jobs noindex after loading; they are not server-rendered job pages.

Suggested domains: existing website domain, `admin.quicksort.fr`, `candidate.quicksort.fr`. Domain DNS changes and external tool provisioning are not part of the app code.

## Verification

- `pnpm build`: builds all three apps; admin/candidate builds include strict TypeScript checking.
- `pnpm test`: URL and upload boundary checks.
- `pnpm test:seo`: static website and EN/FR regression checks.
- `pnpm test:browser`: mocked browser workflows and responsive layouts.
- `supabase/tests/access.sql`: transaction-scoped authorization fixtures. Run using SQL Editor/a write-capable connection; the connector's read-only SQL method cannot execute these fixtures. All inserted fixtures are rolled back.

The verification migration performs the same access assertions inside an exception subtransaction, rolling back its fixtures on success and failing the migration on any failed assertion. The production security advisor reported no findings after schema setup.
