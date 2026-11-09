# Quicksort OS — Architecture

Quicksort OS (Quicksort Operating System, https://os.quicksort.fr) is the
company's internal back-office. It is a single pnpm workspace containing the
admin app, the stand-alone candidate portal, a set of shared packages, and one
versioned Supabase schema. Both apps are built with Vite and React and
deployed to Vercel. Sign-in uses Clerk. Data and authorization live in
Supabase (Postgres, RLS and Storage).

The public marketing site (www.quicksort.fr) lives in its own repository. It
reads the jobs, blog posts and events that Quicksort OS publishes to Supabase.

```text
            ┌──────────── Clerk (blessed-midge-8591) ────────────┐
            │      session JWT  →  Supabase "accessToken"         │
            └─────────────────────────────────────────────────────┘
                        │                          │
             ┌──────────▼──────────┐      ┌────────▼────────┐
             │     apps/admin      │      │ apps/candidate  │
             │ Quicksort OS:       │      │ candidate /     │
             │ back-office +       │      │ employee portal │
             │ candidate portal    │      └────────┬────────┘
             │  + api/ (Vercel fn) │               │ RLS
             └──┬───────────┬──────┘               │
                │ RLS       │ server-side          │
                ▼           ▼                      ▼
  ┌──────────────────────────────┐   OpenAI · Qonto · Google Drive
  │ Supabase: Postgres + RLS +   │
  │ Storage (supabase/migrations)│
  └──────────────────────────────┘
```

## Repository layout

```text
apps/
  admin/          Quicksort OS: staff back-office (Sales, HR, Ops, content, settings) and the
                  candidate self-service portal, plus Vercel serverless API (api/, server/)
  candidate/      Stand-alone candidate/employee portal
packages/
  design-system/  Brand tokens, .qs-* component CSS, React primitives, theme toggle
  hr-db/          Supabase client, generated types, Clerk→Supabase auth hook (admin)
  hr-ui/          Portal shell, AuthGate, nav routing, shared portal components (admin)
  candidate-db/   Supabase client, types, auth hook (candidate app; capability tables in admin)
  candidate-ui/   Portal shell + styles for the candidate app
supabase/
  migrations/     Timestamped SQL migrations — the single source of truth for schema, RLS, RPCs
  tests/          Transaction-scoped access assertions (access.sql)
tests/            Node test runner unit tests (*.test.mjs), SQL fixtures, Playwright specs (*.spec.ts)
scripts/          One-off maintenance scripts (HR DB verification, CRA/invoice gap scan)
docs/             Feature docs (setup, CRA, events, HR lifecycle, portal routes, specs/plans)
```

Domain specs that sit next to code: `apps/prd-hr.md` (HR pipeline PRD),
`apps/admin/sales.md` (Sales module), `apps/admin/ops.md` (Operations board).

## Applications

### `apps/admin` — Quicksort OS back-office and portal (`@quicksort/admin`, port 5174)

The main application. One deployment serves several shells. `src/App.tsx`
picks the shell from the role the database returns after sign-in:

| Role (`user_roles.role`) | Shell | Scope |
| --- | --- | --- |
| `admin`, `hr` | `Admin` | Full back-office. Portal owners (`portal_owners`) also get `/admin-access` |
| `sales` | `StaffingWorkspace` | HR → People only (staffing view) plus account settings |
| anything else | `HrPortal` (lazy) | Candidate/employee self-service: application, documents, contracts, CRA, tool access, team photos |

**Back-office sections** (nav in `App.tsx`; tab strips in `SectionHeader.tsx`):

- **Sales** `/sales/*` (`src/sales/`): dashboard, pipeline board, clients,
  contacts, opportunities, projects (pricing lines, TJM profiles, staffing,
  extensions, billable caps) and **invoicing** (`src/sales/invoicing/`).
- **Operations** `/operations` (`src/ops/`): custom kanban boards.
- **HR** `/hr/*` (`src/hr/`): overview, recruiting (requisitions, pipeline,
  CV analysis), people (one record per person: candidate → employee →
  alumni, with employment, salaries and economics), journeys
  (onboarding/probation/offboarding), documents and job posts. Each person's
  monthly activity report (**CRA**) lives in `src/cra/`.
- **Content and admin:** events, blog posts, administration referentials,
  accounts, tool requests, settings (account, AI configuration, Google Drive).
- `SpotlightSearch.tsx` gives global search across the sections.
  `save-shortcut.ts` installs a global ⌘S.
- Legacy HR paths redirect to the current screens so old bookmarks keep working.

**Server side** (`api/` + `server/`). Each `api/*.ts` file is a Vercel
serverless function. In development, `vite.config.ts` mounts the same handlers
as Connect middleware through `ssrLoadModule`, so `/api/*` behaves the same
locally. `api/` files stay thin, and the logic lives in `server/`.

| Endpoint | Purpose | External service |
| --- | --- | --- |
| `analyze`, `parse-candidate`, `hr-assist`, `analysis-history` | CV analysis, candidate intake parsing, HR assistant | OpenAI via the `ai` SDK |
| `ai-settings`, `ai-models` | Store/test the AI key and model (owner only) | OpenAI |
| `documents`, `documents-extract` | Document registry: upload, register, file, download; AI metadata extraction | Google Drive, OpenAI |
| `google-drive` | Service-account connection for contract folders | Google Drive API |
| `invoicing` | Draft → validate → send → cancel → sync client invoices | Qonto (behind `InvoicingProvider`) |
| `sales-pipeline` | Pipeline board reads/moves | — |

### `apps/candidate` — candidate portal (`@quicksort/candidate`, port 5175)

A smaller stand-alone portal with onboarding, profile (capability profile),
documents, contracts, tool access and account pages. It uses
`@quicksort/candidate-db`/`candidate-ui`. Its CSP targets the
`kupbvrnjppcwqxmzxasi` Supabase project. The admin app's `HrPortal` covers the
same ground for users who sign in to admin without a staff role.

## Shared packages

All packages are source-only (TypeScript `exports` point at `src/`). The
consuming app's Vite build compiles them, and no package has a build step.

- **`design-system`**: the brand foundation. `tokens.css` holds primitive and
  semantic light/dark tokens on `data-theme`. `components.css` holds the
  `.qs-*` primitives. React exports include `Button`, `Card`, `Pill`, `Stat`
  and `ThemeToggle`. Used by `hr-ui`. See its README.
- **`*-db` packages** share one shape. Each has a lazily configured
  `supabase` client (`null` when env vars are missing, which the UI shows as
  "coming online"), `db()`, `errorMessage`, `isMissingRelationError`, and
  storage helpers (`downloadFile`, `sha256`). They also hold generated
  `database.types.ts` and validation helpers. `hr-db` also exports
  hand-written `hr.types.ts`/`documents.types.ts` and the `useAuth` hook.
- **`*-ui` packages**: the portal `Shell`, `AuthGate`, `AccountSecurity`,
  `resolvePortalRoute`/`usePortalRoute` (longest-prefix section matching) and
  portal theme CSS.

## Authentication and authorization

1. **Clerk** handles sign-in (`ClerkProvider` in each app's `main.tsx`). The
   apps never use Supabase Auth sessions directly.
2. The Supabase client is created with `accessToken: () => sessionToken()`.
   `useAuth` (`packages/hr-db/src/auth.tsx`) wires that to
   `clerkSession.getToken({ template: "supabase" })`. The candidate package
   uses the default Clerk token.
3. After sign-in the hook calls the `sync_clerk_profile` RPC, which maps the
   Clerk subject to a workspace user id (migrations `*_clerk_access_bridge`,
   `*_workspace_user_id_claim`). It then reads `user_roles`, `portal_owners`
   and `profiles`. Identity refreshes every 15 s and on window focus.
4. **The database enforces access, not the UI.** Every exposed table has RLS.
   Roles live in `user_roles`, which clients can read but not write. New users
   start as candidates. Fine-grained role checks are `private.*` security
   definer functions.
5. **Serverless functions use the caller's identity.** Handlers build a
   Supabase client with the caller's bearer token and the *publishable* key.
   RLS therefore applies to them too. `server/portal-auth.ts`
   (`requirePortalOwner`) gates owner-only operations. No service-role key is
   used anywhere except by the bank cron (item 7), which has no caller
   identity.
6. **Third-party secrets** (OpenAI key, Qonto credentials, Google
   service-account JSON, Kimi key in `ai_settings` id `bank-classifier`) are
   stored encrypted in settings tables.
   `AI_SETTINGS_ENCRYPTION_KEY` (server env only) encrypts and decrypts them.
   The `OPENAI_API_KEY` env var acts as a fallback. Never prefix
   a secret with `VITE_`.
7. **Bank sync env vars** (admin app, server only): `CRON_SECRET` is the
   bearer Vercel cron sends to `/api/bank-transactions-cron`.
   `MOONSHOT_API_KEY` is a fallback; the Kimi key is normally set in
   Settings → Transaction classification (`ai_settings`, id
   `bank-classifier`). The cron has no caller identity, so it is the one
   path that needs `SUPABASE_SERVICE_ROLE_KEY` (without it, it returns 503).

## Data layer (Supabase)

- **Migrations** in `supabase/migrations/` are append-only and timestamped.
  Apply them with `pnpm exec supabase db push --linked`. Never edit or replay
  applied files. Each migration that changes the API surface reloads the
  PostgREST schema cache.
- **Patterns:**
  - *Command RPCs for multi-row invariants.* Examples: `hr_command`
    (transactional HR writes) with the scoped `hr_workspace_snapshot` read,
    `cra_save_month` (optimistic `expected_version`), and `register_document`
    (atomic supersede on renewal). Clients write tables directly only for
    simple CRUD under RLS.
  - *Immutable event logs*: `hr_events`/`pipeline_events`, `invoice_events`,
    and document-access logging via `log_document_access`.
  - *Candidate-facing views* (`my_applications`, `my_employment`,
    `my_offers`, …) expose only the caller's rows and never scores.
- **Main domains:**
  - **HR:** `hr_people`, `hr_applications`, `employees` (employment periods,
    contract type, salaries, daily rate), requisitions, onboarding/offboarding,
    leave accrual.
  - **CRA:** `cra_months`, `cra_entries` (full/am/pm).
  - **Sales:** clients, contacts, opportunities, projects, pricing lines,
    assignments, extensions.
  - **Invoicing:** `invoices`, `invoice_lines`, `invoicing_*_links`,
    `invoicing_settings`.
  - **Documents:** `document_types`, `documents`, `document_folders`.
  - **Ops:** boards, columns, cards.
  - **Business:** `business_*` tables plus audit logs.
  - **Content:** `jobs`, blog, events (read by the public website).
  - **Access:** `user_roles`, `portal_owners`, `profiles`.
- **Storage:** private buckets `candidate-documents` and `contracts` (10 MB,
  self-folder policies keyed by user id or Clerk `sub`). The newer document
  registry stores files in **Google Drive**. Supabase holds only the metadata
  and the folder cache.
- **Projects:** admin targets `ctgtowqjswbxwiapcvfj`. The candidate CSP
  targets `kupbvrnjppcwqxmzxasi`.
  Check an app's `VITE_SUPABASE_URL` before running migrations against it.

## Key cross-cutting flows

- **CRA → invoicing:** employees (or HR) fill a monthly CRA against project
  assignments. Invoicing builds Qonto drafts from CRA days × pricing-line
  TJM. Invoiced months are locked (`private.cra_invoiced`) so billed days
  cannot change. Spec: `docs/superpowers/specs/2026-10-28-client-invoicing-qonto-design.md`.
- **Recruiting → employee → alumni:** a person keeps one record across
  stages. Hiring creates an employment period. Offboarding ends active
  assignments (`*_offboarding_ends_assignments`).
- **Documents:** the browser asks `/api/documents` to `prepare-upload`, PUTs
  the bytes straight to Drive, then calls `register`. A file that cannot be
  registered goes to the trash. Listing and alerts query Supabase directly
  under RLS.
- **Bank transactions → business-plan fixed charges:** `apps/admin/server/bank/`
  syncs Qonto transactions incrementally into Supabase and classifies them
  with Kimi (Moonshot). `api/bank-transactions.ts` serves the admin UI
  (list, refresh, drill-down); `api/bank-transactions-cron.ts` runs daily at
  05:00 UTC. Closed months in the business plan read their fixed charges
  from these rows, and a month with no Qonto rows is never shown as 0 €.

## Deployment

One Vercel project per app (admin is served at `https://os.quicksort.fr`), each with its Root Directory set to `apps/<app>`,
build command `pnpm build`, output `dist`, and source outside the root
enabled so workspace packages bundle. Each `vercel.json` sets SPA rewrites
(everything except `/api/*` goes to `index.html`), a strict CSP, `noindex`
(portals), and `no-store`. Changing env vars requires a rebuild because Vite
inlines `VITE_*`. Details: `docs/setup.md`.

## Development and testing

```sh
pnpm install
pnpm dev:admin        # 5174   (pnpm dev is an alias)
pnpm dev:candidate    # 5175
pnpm build            # all apps; admin/candidate builds also typecheck and check photo assets
pnpm typecheck
pnpm test             # node --test tests/*.test.mjs (pure domain/handler logic)
pnpm test:browser     # Playwright, mocked network (tests/*.spec.ts)
pnpm test:hr-db       # scripts/verify-hr-database.mjs (replays migrations into a Docker Postgres via psql)
```

Each app needs `.env.local`, built from its `.env.example`. SQL fixtures in
`tests/*.sql` and `supabase/tests/access.sql` run in a transaction and roll
back.

## Conventions

- Business rules live in pure modules (`domain.ts`, `billable-cap.ts`,
  `server/invoicing/month.ts`, …) so `node --test` can test them without a
  browser or database.
- External integrations sit behind an interface (`InvoicingProvider`,
  `DocumentStorage`) with one concrete adapter (Qonto, Google Drive).
- Styling: brand tokens come from `@quicksort/design-system`. Each feature
  keeps a co-located `.css` file.
- AI output is advisory. Match scores never auto-reject a candidate, and
  failures are classified (`server/ai-failure.ts`) into user-facing messages.
