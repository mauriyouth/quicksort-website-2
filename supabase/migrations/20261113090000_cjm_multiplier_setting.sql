-- Unit-economics settings: the salary-to-CJM conversion used when drafting
-- offers (FR-5.3.3). CJM = gross monthly salary × multiplier ÷ 21.7 working
-- days per month (the §1 intercontrat convention). Single-row table
-- (boolean id guard), mirroring the leave_accrual_settings pattern: typed
-- table, migration seed, RLS on private.is_admin(), edited from Global
-- settings, and the TS side degrades to the same default (2) while the
-- migration is pending. The multiplier reprices offer *suggestions* only —
-- stored offer CJM values are never rewritten.

create table public.hr_economics_settings (
  id boolean primary key default true check (id),
  cjm_multiplier numeric not null check (cjm_multiplier > 0),
  updated_at timestamptz not null default now()
);
insert into public.hr_economics_settings (id, cjm_multiplier) values (true, 2);
alter table public.hr_economics_settings enable row level security;
-- Default privileges keep service_role access; one policy gates admin edits.
create policy hr_economics_settings_admin on public.hr_economics_settings
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
