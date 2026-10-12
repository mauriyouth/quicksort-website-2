# Quicksort

One pnpm workspace, three independently deployed applications.

```text
apps/
  web/          Existing marketing website and careers
  admin/        HR pipeline administration: requisitions → candidates → interviews →
                offers → onboarding → probation → offboarding
  hr/           HR self-service portal: application status, documents, contracts,
                tool access, AI disclosure and GDPR rights
packages/
  db/           Supabase clients, generated database types, authentication (marketing site)
  ui/           Shared marketing components and brand tokens
  hr-db/        Portal Supabase clients, database types, authentication (admin + hr apps)
  hr-ui/        Shared portal components and brand tokens (admin + hr apps)
supabase/
  migrations/   Versioned schema and transactional access verification
  tests/        Repeatable database access checks
```

## Local development

Use Node.js 22 and pnpm 11.19.0. Run `pnpm install` from the repository root.
Copy each application's `.env.example` to `.env.local`, then set the Supabase URL and publishable key. The admin app in this working checkout is configured for project `ctgtowqjswbxwiapcvfj`. Check each application's configured URL before applying migrations.

```sh
pnpm dev:web        # http://127.0.0.1:5173
pnpm dev:admin      # http://127.0.0.1:5174
pnpm dev:hr         # http://127.0.0.1:5175
pnpm build
pnpm typecheck
pnpm test
pnpm test:seo
pnpm test:browser
```

Browser tests use an installed Microsoft Edge, mock network records, and do not create real accounts. Database access tests were also run against the connected Supabase database with all fixtures rolled back. For CI/Linux, change the Playwright channel or install Edge using Playwright.

## Applications

- **Web:** the original design, assets, translations, blog, prerender scripts and website configuration live inside `apps/web`. Careers query published Supabase jobs on page load, window focus and every 60 seconds. A failed query clears the list and displays a retry action; historical static jobs are never used as a fallback. Job detail routes use a dedicated app shell, so newly published roles work without rebuilding the site. Static marketing pages remain prerendered. Dynamic roles are not currently included in the static sitemap.
- **Admin:** run the full HR pipeline from `prd-hr.md`: requisitions with hiring-mode tags (sur mission / sur profil) and approval workflow; a drag-and-drop Kanban with SLA heat, gated transitions and an immutable event log; the CVthèque (one record per person: candidate → employee → alumni) with advisory AI match scores that never auto-reject; interview scheduling with evidence-based scorecards; offers with unit economics (CJM, target TJM, 25-40% margin corridor) and an HR → Direction approval chain; onboarding plans, parrainage and probation reviews; offboarding workflows with handover gate and alumni conversion. Also: job posts, contracts with e-signature, tool requests, blog posts, CV analysis and access management. Sales projects keep their client contract and annexes on Google Drive — one folder per contract (named `Client/Contract`) under the shared `Contrats_Clients` root — uploaded straight from the project edit dialog through an encrypted service-account connection (Settings → Google Drive contracts).
- **HR portal:** follow application status on a timeline (never scores or rankings), read the AI-use disclosure, request human re-review and exercise GDPR rights (access, rectification, erasure, portability, viewpoint); upload/download/remove onboarding files; view/download assigned contracts; type an electronic signature with consent; download a signature receipt; request tool access and read the team's response; update name/password.

Signing stores the signer name, server timestamp, consent text and SHA-256 fingerprint in an immutable record. The original PDF and a separate JSON signature receipt can be downloaded. This does not embed a signature in the PDF or integrate an external e-signature provider. Tool approvals record a decision; they do not provision third-party accounts.

See [setup and deployment](docs/setup.md) for the first admin account, Auth redirects and the three Vercel projects. Existing website documentation is in [apps/web/README.md](apps/web/README.md).
