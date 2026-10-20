-- Optional annual cap on billable days for delivery projects (sales.md §14).
-- The app stores the full-year figure the client contracted (e.g. 210 days)
-- and prorates it per calendar year from the contract window: a project
-- starting mid-year gets max × open days left in the year ÷ open days in
-- the year, computed in apps/admin/src/sales/billable-cap.ts. NULL means
-- the project is exempt — no yearly cap.
alter table public.sales_projects
  add column max_billable_days_per_year numeric;

alter table public.sales_projects
  add constraint sales_projects_max_billable_days_chk
  check (max_billable_days_per_year is null or max_billable_days_per_year > 0);
