# Quicksort OS

Quicksort Operating System — Quicksort's internal back-office, served at
**https://os.quicksort.fr**. One pnpm workspace:

```text
apps/
  admin/          Quicksort OS: Sales, HR, Operations, content and settings, plus the
                  candidate/employee self-service portal and the Vercel API (api/, server/)
  candidate/      Stand-alone candidate/employee portal
packages/
  design-system/  Brand tokens, .qs-* component CSS, React primitives
  hr-db/          Supabase clients, database types, Clerk → Supabase auth (admin)
  hr-ui/          Portal shell, AuthGate, nav routing, shared portal components (admin)
  candidate-db/   Supabase client, types, auth hook (candidate app)
  candidate-ui/   Portal shell and styles for the candidate app
supabase/
  migrations/     Versioned schema, RLS and RPCs
  tests/          Repeatable database access checks
```

The public marketing website (www.quicksort.fr) lives in its own repository. It
reads the jobs, blog posts and events that Quicksort OS publishes to Supabase.

## Local development

Use Node.js 22 and pnpm 11.19.0. Run `pnpm install` from the repository root.
Copy each application's `.env.example` to `.env.local`, then set the Supabase URL and publishable key. The admin app is configured for project `ctgtowqjswbxwiapcvfj`. Check each application's configured URL before applying migrations.

```sh
pnpm dev            # Quicksort OS (admin) at http://127.0.0.1:5174
pnpm dev:candidate  # http://127.0.0.1:5175
pnpm build
pnpm typecheck
pnpm test
pnpm test:browser
```

Browser tests use an installed Microsoft Edge, mock network records, and do not create real accounts. For CI/Linux, change the Playwright channel or install Edge using Playwright.

## What's in Quicksort OS

- **Sales:** dashboard, pipeline board, clients, contacts, opportunities, projects (pricing lines, TJM profiles, staffing, extensions, billable caps) and invoicing through Qonto. Client contracts and annexes live on Google Drive, one folder per contract under the shared `Contrats_Clients` root.
- **HR:** requisitions, recruiting pipeline with SLA heat and an immutable event log, CV analysis with advisory AI match scores that never auto-reject, people (one record per person: candidate → employee → alumni), onboarding/probation/offboarding journeys, documents, job posts and monthly activity reports (CRA).
- **Operations:** kanban boards and the business plan, with fixed charges read from synced Qonto bank transactions.
- **Content and admin:** events, blog posts and job posts for the public website, referentials, accounts, tool requests and settings (account, AI configuration, Google Drive).
- **Candidate/employee portal:** application status on a timeline (never scores or rankings), AI-use disclosure, GDPR rights, onboarding files, CRA and tool access requests.

Contracts are not signed in the portal. An admin sends them from the person's application or employment page, the person signs in Youtrust, and the signed copy is filed in Documents. Tool approvals record a decision; they do not provision third-party accounts.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit, and [setup and deployment](docs/setup.md) for the first admin account, Auth redirects and the Vercel projects.
