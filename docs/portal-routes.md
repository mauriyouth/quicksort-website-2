# Portal URL navigation

Both Clerk portals use browser history for their main sections. Sidebar links support direct linking, opening a new tab, refresh, and Back/Forward. Root URLs redirect to each portal's default section after authentication. Unknown paths show a not-found message. Sign-in preserves the requested path and query string.

Candidate: `/onboarding`, `/documents`, `/contracts`, `/tool-access`, `/team-photos`, `/account`.

Admin: `/overview`, `/jobs`, `/cv-analyzer`, `/analysis-history`, `/blog-posts`, `/candidates`, `/contracts`, `/tool-requests`, `/settings`. Owners also have `/admin-access`; it remains protected by the existing owner checks.

The admin source was reconciled from the existing Clerk implementation in the original quicksort-website-2 checkout, including CV analysis, history, blogs, AI settings and access management. Both portals use the isolated candidate-db and candidate-ui packages so the marketing site's existing shared packages remain unchanged.

Vercel SPA rewrites serve these paths through index.html; API endpoints remain separate. Deploy each portal to its verified project in Mohammed's team. The candidate's ignored private portrait assets must accompany its deployment (see candidate-photos.md). Verify production account, environment and domain mapping before release.
