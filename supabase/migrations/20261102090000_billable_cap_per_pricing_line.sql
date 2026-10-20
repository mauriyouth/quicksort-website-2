-- The annual billable-days cap lives on each pricing line, not the
-- project: tjm_profiles[].max_billable_days_per_year (same JSONB line
-- shape on sales_project_extensions), prorated per line window — see
-- apps/admin/src/sales/billable-cap.ts. The project-level column was
-- introduced and replaced within the same release window and was never
-- populated, so it drops without a backfill.
alter table public.sales_projects
  drop column max_billable_days_per_year;
