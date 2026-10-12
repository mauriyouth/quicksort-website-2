-- Multi-profile régie pricing for delivery projects (sales.md §8.11). A
-- contract can carry any number of TJMs, one per profile with a free-text
-- name, each with its own rate and day volume; only the JSON array shape is
-- enforced. The flat tjm/estimated_days columns stay in sync (blended rate /
-- total days) so existing consumers (projects table, extensions, dashboards)
-- keep working unchanged. `amount` can no longer be a generated column (the
-- sum spans JSONB rows), so the app maintains it: régie = Σ tjm × days over
-- the profiles, forfait = fixed_price.
alter table public.sales_projects
  add column tjm_profiles jsonb not null default '[]';

alter table public.sales_projects
  add constraint sales_projects_tjm_profiles_chk
  check (jsonb_typeof(tjm_profiles) = 'array');

-- Existing régie projects become a single unnamed profile with the same
-- rate and days, so their displayed pricing is unchanged. The evidence
-- version trigger is paused so the backfill doesn't bump every row.
alter table public.sales_projects disable trigger hr_project_version;

update public.sales_projects
set tjm_profiles = jsonb_build_array(
      jsonb_build_object('name', '', 'tjm', tjm, 'days', estimated_days))
where pricing_model = 'regie' and tjm is not null;

-- amount: generated (flat columns only) → plain, app-maintained. Copy the
-- computed values out, drop the generated column, re-add it plain.
alter table public.sales_projects add column amount_value numeric;
update public.sales_projects set amount_value = amount;
alter table public.sales_projects drop column amount;
alter table public.sales_projects rename column amount_value to amount;
alter table public.sales_projects alter column amount set default 0;
alter table public.sales_projects alter column amount set not null;

alter table public.sales_projects enable trigger hr_project_version;
