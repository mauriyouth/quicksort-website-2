-- Per-line pricing on project extensions. A pricing line is a named daily
-- rate ("Data Engineer" at 700 €/day) with its own end date — the same shape
-- as sales_projects.tjm_profiles — so a renewal can amend the initial
-- contract line by line: new end dates, new rates, added/removed lines.
-- Only the JSON array shape is enforced; the app keeps the flat
-- tjm/estimated_days columns in sync (blended rate / total days), so the
-- generated `amount` column and existing consumers stay correct untouched.

alter table public.sales_project_extensions
  add column tjm_profiles jsonb not null default '[]';

alter table public.sales_project_extensions
  add constraint sales_project_extensions_tjm_profiles_chk
  check (jsonb_typeof(tjm_profiles) = 'array');
