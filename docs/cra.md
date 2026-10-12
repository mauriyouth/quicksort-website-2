# Monthly CRA

Employees open **My CRA** at `/cra`. HR and administrators open **HR → CRA** at `/hr/cra` and select an employee.

Each entry represents a full day, a morning (`am`) or an afternoon (`pm`). Two halves of the same day may carry different activities; when both halves match, the app stores a single full-day entry. The available activities are RTT, Congés sans solde, Congés Payés, Internal, and Client Project.

The month opens as a Monday–Friday calendar. Click, drag or Shift-click to select days, choose **Full day**, **Morning** or **Afternoon**, and paint the selection with an activity brush. Client Project brushes list every project assigned to the employee (confirmed, active or completed) — even outside the viewed month — but only apply on dates covered by the assignment, reporting skipped days. The summary counts filled days in half-day steps (0.5 granularity) and the **Fill … empty** strip paints the default project onto every empty working day it covers. Weekends are hidden until selected for display; public holidays and days outside the employment period are locked. A `?month=YYYY-MM` query parameter deep-links a month.

Client Project entries reference an employee's project assignment. Confirmed, active, and completed assignments are available within their start and end dates. Proposed, reserved, and cancelled assignments are excluded.

**Fill … empty** (default project strip) fills weekdays within the employment period and preserves existing entries. For client projects, the action also checks assignment dates. Weekends are hidden until selected for display. Recorded weekend entries remain visible.

**Save** saves the selected employee's month in one transaction. Employees and administrators edit the same records. The database records the last editor and rejects saves based on an outdated version. After a conflict, **Discard** retrieves the saved month.

Unsaved drafts stay in session storage, separately for each signed-in email, employee, and month. Drafts survive navigation and refresh in the same browser tab. Save the CRA before closing the tab.

## Enable the database

Apply `supabase/migrations/20261015090000_employee_cra.sql` after the HR lifecycle migration, then `supabase/migrations/20261027090000_cra_half_days.sql`. The first creates `cra_months`, `cra_entries`, and the authenticated `cra_context`, `cra_month_snapshot`, and `cra_save_month` functions; the second adds the `part` column (`full`/`am`/`pm`, primary key with employee and day) and re-creates the snapshot and save functions. Both reload the PostgREST schema cache.

The migration was applied to the connected project `ctgtowqjswbxwiapcvfj` on October 4, 2026. A read-only check verified the authenticated employee context and monthly snapshot functions.

Employees need an explicit account link in `hr_person_accounts`. HR and administrators can read and edit every employee CRA. Sales employees can fill their own CRA from the staffing portal. Anonymous users cannot access the CRA functions. Table writes are restricted to the save function.

## Verify the feature

Run these checks from the repository root:

```sh
pnpm typecheck
pnpm --filter @quicksort/admin build
pnpm exec playwright test tests/cra.spec.ts tests/portal.spec.ts tests/hr-workspace.spec.ts
pnpm test:hr-db
```

The database verifier uses the isolated Docker container documented in [HR implementation](hr-implementation.md#verification). It checks permissions, the five activities, dated project assignments, atomic rollback, and concurrent employee and administrator saves. Browser tests use fixture requests with the real CRA component and Supabase client.
