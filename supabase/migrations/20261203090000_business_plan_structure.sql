-- Business plan: structure staff (non-consultant salaried employees). Every
-- other employee counts as a consultant — in inter-contract when unstaffed —
-- and the "Salaires structure" line is computed from these people instead of
-- a fixed hypothesis.
create table if not exists public.business_plan_structure (
 employee_id uuid primary key references public.employees(id) on delete cascade,
 added_by text not null default '',
 added_at timestamptz not null default now()
);

alter table public.business_plan_structure enable row level security;
drop policy if exists business_plan_structure_admin on public.business_plan_structure;
create policy business_plan_structure_admin on public.business_plan_structure for all to authenticated
 using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.business_plan_structure from anon;
grant select, insert, update, delete on public.business_plan_structure to authenticated;
