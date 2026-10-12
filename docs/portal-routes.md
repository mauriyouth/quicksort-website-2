# Portal URL navigation

Both Clerk portals use browser history for their main sections. Sidebar links support direct linking, opening a new tab, refresh, and Back/Forward. Root URLs redirect to each portal's default section after authentication. Unknown paths show a not-found message. Sign-in preserves the requested path and query string.

Candidate: `/onboarding`, `/application`, `/documents`, `/contracts`, `/tool-access`, `/team-photos`, `/account`.

Employees also have **My CRA** at `/cra`. HR and administrators fill employee CRAs at `/hr/cra`. See [monthly CRA](cra.md) for activities, permissions, and database setup.

Admin: `/overview`, `/sales` (redirects to `/sales/opportunities`), `/sales/opportunities`, `/hr` (redirects to `/hr/pipeline`), `/hr/pipeline`, `/hr/candidates`, `/hr/interviews`, `/hr/offers`, `/hr/jobs`, `/hr/onboarding`, `/hr/offboarding`, `/hr/cv-analyzer`, `/analysis-history`, `/blog-posts`, `/accounts`, `/contracts`, `/tool-requests`, `/settings`. Opportunities are owned by Sales and live under the `/sales` top-level route behind a single “Sales” sidebar item (the commercial funnel that feeds the HR pipeline); inside the section a horizontal submenu switches between the Sales pages. The HR modules live under the `/hr` top-level route behind a single “HR” sidebar item; inside the section a horizontal submenu switches between the HR pages. Owners also have `/admin-access`; it remains protected by the existing owner checks.

The HR pipeline modules implement `apps/prd-hr.md`: the 16-stage model (§3.1) renders stages 3-11 as the drag-and-drop Kanban with gated transitions and an immutable `pipeline_events` log (§3.2); opportunities carry the mandatory sur mission / sur profil hiring-mode tag with the pipeline-justification gate (§3.3); match scores are explainable and advisory — no auto-rejection path exists (FR-4.3); offers compute CJM / target TJM / margin against the 25-40% corridor with an HR → Direction approval chain (FR-5.3.3); onboarding covers pre-boarding, parrainage ≤ day 7 and logged probation decisions (§6.1-6.2); offboarding runs checklisted workflows with a handover completion gate and alumni conversion (§6.3).

The admin source was reconciled from the existing Clerk implementation in the original quicksort-website-2 checkout, including CV analysis, history, blogs, AI settings and access management. Both portals use the isolated hr-db and hr-ui packages so the marketing site's existing shared packages remain unchanged.

Vercel SPA rewrites serve these paths through index.html; API endpoints remain separate. Deploy each portal to its verified project in Mohammed's team. The HR app's ignored private portrait assets must accompany its deployment (see candidate-photos.md). Verify production account, environment and domain mapping before release.
