-- Leave accrual settings + derived leave balances. Employees accrue paid
-- vacation (CP) and reduced working time (RTT) per calendar month from
-- employees.start_date; both rates are admin-configurable, mirroring the
-- admin_statuses pattern (typed table, migration seed, RLS on
-- private.is_admin(), edited from Global settings via db()).

create table public.leave_accrual_settings (
  kind text primary key check (kind in ('cp','rtt')),
  rate numeric not null check (rate > 0 and rate <= 31),
  updated_at timestamptz not null default now()
);
insert into public.leave_accrual_settings (kind, rate) values ('cp', 2.08), ('rtt', 0.8);
alter table public.leave_accrual_settings enable row level security;
-- Default privileges keep service_role access; one policy gates admin edits.
create policy leave_accrual_settings_admin on public.leave_accrual_settings
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Derived read model: one row per employee (caller-visible via cra_access) per
-- leave kind. Nothing is stored; the function IS the balance.
create type public.leave_balance as (
  employee_id uuid, kind text,
  accrued numeric, consumed numeric, available numeric
);

create function public.employee_leave_balances() returns setof public.leave_balance
language sql stable security definer set search_path='' as $$
  with bounds as (
    -- Accrual window: start month … min(current month, end month).
    select e.id,
      date_trunc('month', e.start_date)::date as first_month,
      date_trunc('month', least(current_date, coalesce(e.end_date, current_date)))::date as last_month
    from public.employees e
    where private.cra_access(e.id)          -- HR operator or the employee themself
  ), windows as (
    select id,
      greatest(0,
        (extract(year from last_month)::int * 12 + extract(month from last_month)::int)
      - (extract(year from first_month)::int * 12 + extract(month from first_month)::int) + 1
      ) as months
    from bounds
    where last_month >= first_month          -- future start_date yields no row
  ), rates as (
    -- Defaults duplicated on purpose: balances stay correct even if the
    -- settings table is empty. Mirror changes in DEFAULT_LEAVE_RATES (TS).
    select 'cp' as kind, coalesce((select rate from public.leave_accrual_settings where kind='cp'), 2.08) as rate
    union all
    select 'rtt', coalesce((select rate from public.leave_accrual_settings where kind='rtt'), 0.8)
  ), consumption as (
    select employee_id,
      case when status='paid_leave' then 'cp' else 'rtt' end as kind,
      sum(case when part='full' then 1 else 0.5 end) as days   -- half-day weighting
    from public.cra_entries
    where status in ('paid_leave','rtt')
    group by 1, 2
  )
  select w.id as employee_id, r.kind,
    round(w.months * r.rate, 2)                       as accrued,
    coalesce(c.days, 0)                               as consumed,
    round(w.months * r.rate, 2) - coalesce(c.days, 0) as available
  from windows w
  cross join rates r
  left join consumption c on c.employee_id = w.id and c.kind = r.kind
$$;
revoke all on function public.employee_leave_balances() from public, anon;
grant execute on function public.employee_leave_balances() to authenticated;
notify pgrst, 'reload schema';
