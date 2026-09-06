# Quicksort

One pnpm workspace, three independently deployed applications.

```text
apps/
  web/          Existing marketing website and careers
  admin/        Hiring and onboarding administration
  candidate/    Candidate onboarding workspace
packages/
  db/           Supabase clients, generated database types, authentication
  ui/           Shared portal components and brand tokens
supabase/
  migrations/   Versioned schema and transactional access verification
  tests/        Repeatable database access checks
```

## Local development

Use Node.js 22 and pnpm 11.19.0. Run `pnpm install` from the repository root.
Copy each application's `.env.example` to `.env.local`, then set the Supabase URL and publishable key. The local copies in this working checkout are already configured for project `kupbvrnjppcwqxmzxasi`.

```sh
pnpm dev:web        # http://127.0.0.1:5173
pnpm dev:admin      # http://127.0.0.1:5174
pnpm dev:candidate  # http://127.0.0.1:5175
pnpm build
pnpm typecheck
pnpm test
pnpm test:seo
pnpm test:browser
```

Browser tests use an installed Microsoft Edge, mock network records, and do not create real accounts. Database access tests were also run against the connected Supabase database with all fixtures rolled back. For CI/Linux, change the Playwright channel or install Edge using Playwright.

## Applications

- **Web:** the original design, assets, translations, blog, prerender scripts and website configuration live inside `apps/web`. Careers query published Supabase jobs on page load, window focus and every 60 seconds. A failed query clears the list and displays a retry action; historical static jobs are never used as a fallback. Job detail routes use a dedicated app shell, so newly published roles work without rebuilding the site. Static marketing pages remain prerendered. Dynamic roles are not currently included in the static sitemap.
- **Admin:** create, edit, publish, unpublish and delete job posts; review candidate documents; share immutable PDF contracts; review signatures; approve/decline tool requests; set or change passwords.
- **Candidate:** create an email/password account; upload/download/remove onboarding files; view/download assigned contracts; type an electronic signature with consent; download a signature receipt; request tool access and read the team's response; update name/password.

Signing stores the signer name, server timestamp, consent text and SHA-256 fingerprint in an immutable record. The original PDF and a separate JSON signature receipt can be downloaded. This does not embed a signature in the PDF or integrate an external e-signature provider. Tool approvals record a decision; they do not provision third-party accounts.

See [setup and deployment](docs/setup.md) for the first admin account, Auth redirects and the three Vercel projects. Existing website documentation is in [apps/web/README.md](apps/web/README.md).
