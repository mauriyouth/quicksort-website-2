-- Business plan (Operations › Business plan): one editable plan per year.
-- Closed months are computed from real data (invoices, staffing, CRA,
-- salaries, exits); this row only stores what has no source table — the
-- hypotheses (TJM, occupancy, fixed costs, opening cash…) and the manual
-- sales / departures entered for forecast months.
create table public.business_plans (
 year integer primary key check (year between 2000 and 2100),
 hypotheses jsonb not null default '{}'::jsonb,
 monthly jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 updated_by text not null default ''
);

alter table public.business_plans enable row level security;
create policy business_plans_admin on public.business_plans for all to authenticated
 using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.business_plans from anon;
grant select, insert, update, delete on public.business_plans to authenticated;
