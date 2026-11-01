# Research usage

QuickSort pays Treg centrally. Admins are not invoiced or charged individually.
Competitor research and attendee enrichment use the Admin backend's shared Treg
wrapper. The authenticated profile ID supplies `admin`; the fixed customer is
`quicksort`, workspace is `business`, and feature is `competitors` or `events`.
Neither prompts nor client request bodies can choose attribution.

## Enable

1. Apply `supabase/migrations/20261101153753_treg_usage.sql`.
2. On the Admin deployment, configure `TREG_TOKEN` (an organization-scoped token),
   `TREG_ORG_ID` (the organization ID), and `SUPABASE_SERVICE_ROLE_KEY`.
   Existing `TREG_ORG` is supported for identity-token compatibility. Set
   `TREG_REPORT_TOKEN` if the call token cannot read the organization ledger.
   Never prefix these secrets with `VITE_`.
3. Deploy Admin and Business. Open `/research-usage` in Business as an admin.
4. Run one competitor lookup and one attendee enrichment; confirm the profile
   ID appears in the ledger and the corresponding call IDs appear in `treg_usage`.
   No billable calls are made by automated tests.
5. Enable auto top-up or balance alerts in Treg for QuickSort's prepaid account.

The new recording configuration and table are required before research runs.
The server probes storage before making paid calls. Writes are server-only;
authenticated admins can read audit rows but cannot fabricate costs.

## Accounting and reconciliation

The 30-day report comes from `/orgs/<id>/usage/by-tag?key=admin&days=30`.
It validates integer micro-USD, row totals, and attributed + unattributed = total.
Unattributed spending is shown explicitly: earlier calls have no admin tag and
cannot reliably be assigned retroactively. This is an organization-wide report;
use a dedicated Treg organization to exclude other products' spending.
The report excludes OpenAI charges and is not a calendar-month invoice.

Local `treg_usage` rows are an audit trail, not the billing authority. Call IDs
are unique, replays preserve the original charge, and null cost means Treg did
not provide a metered cost. No attendee data, response bodies, or secrets are
stored. If persistence fails after an upstream charge, research reports failure;
the Treg ledger remains authoritative. Use its call ID/result endpoints for
investigation and recovery.

Every outgoing call includes a unique idempotency key. There are no automatic
retries; a new user-triggered research operation is a new billable operation.
Keep the same key if automatic retries are added. Existing per-call reservation
ceilings remain $0.20 for competitors and $0.10 for attendee enrichment; they
are not exact monthly budgets. No new spending policy is imposed on admins.
For optional limits, Treg supports organization-admin PUT requests to
`/orgs/<id>/budgets/admin/<profile-id>` with `daily_cap_micro`; its aggregate
caps can overshoot under concurrency. Configure limits centrally in Treg.

Provider and account error bodies are never forwarded to the browser. Event
research stops on errors rather than silently presenting failed enrichment
as a successful empty result.

Reference: https://treg.to/integrate.md
