-- Paid leave (CP) payslip checkpoint. The derived CP balance only knows the
-- leave booked in the CRA, so leave taken before the CRA existed (or recorded
-- only by payroll) made it drift from the payslip. HR copies the "Congés N-1 /
-- Congés N" box of one payslip; the balance then starts from those figures
-- and only adds accrual for the months after that payslip and CRA paid leave
-- dated after it. One checkpoint per employment; a newer payslip replaces it.
-- RTT is unaffected (payslips carry no RTT counter).

create table public.leave_payslip_checkpoints (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),   -- payslip month
  n1_acquired numeric(6,2) not null default 0 check (n1_acquired >= 0),
  n1_taken numeric(6,2) not null default 0 check (n1_taken >= 0),
  n_acquired numeric(6,2) not null default 0 check (n_acquired >= 0),
  n_taken numeric(6,2) not null default 0 check (n_taken >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default private.workspace_user_id()
);
alter table public.leave_payslip_checkpoints enable row level security;
revoke all on public.leave_payslip_checkpoints from anon;
grant select, insert, update, delete on public.leave_payslip_checkpoints to authenticated;
create policy leave_payslip_checkpoints_hr on public.leave_payslip_checkpoints
  for all to authenticated using ((select private.hr_operator())) with check ((select private.hr_operator()));

create or replace function public.employee_leave_balances() returns setof public.leave_balance
language sql stable security definer set search_path='' as $$
  with bounds as (
    -- Accrual window: start month … min(current month, end month).
    select e.id,
      date_trunc('month', e.start_date)::date as first_month,
      date_trunc('month', least(current_date, coalesce(e.end_date, current_date)))::date as last_month
    from public.employees e
    where private.cra_access(e.id)          -- HR operator or the employee themself
      and e.contract_type <> 'Freelance'    -- freelancers accrue no CP/RTT
  ), windows as (
    select id, last_month,
      (extract(year from last_month)::int * 12 + extract(month from last_month)::int)
      - (extract(year from first_month)::int * 12 + extract(month from first_month)::int) + 1 as months
    from bounds
    where last_month >= first_month          -- future start_date yields no row
  ), rates as (
    -- Defaults duplicated on purpose: balances stay correct even if the
    -- settings table is empty. Mirror changes in DEFAULT_LEAVE_RATES (TS).
    select 'cp' as kind, 'paid_leave' as status, coalesce((select rate from public.leave_accrual_settings where kind='cp'), 2.08) as rate
    union all
    select 'rtt', 'rtt', coalesce((select rate from public.leave_accrual_settings where kind='rtt'), 0.8)
  )
  select w.id as employee_id, r.kind, b.accrued, b.consumed, b.accrued - b.consumed as available
  from windows w
  cross join rates r
  left join public.leave_payslip_checkpoints ck on r.kind = 'cp' and ck.employee_id = w.id
  cross join lateral (
    select
      case when ck.employee_id is null then round(w.months * r.rate, 2)
        -- Payslip figures, then the months after the payslip month.
        else ck.n1_acquired + ck.n_acquired + round(greatest(0,
            (extract(year from w.last_month)::int * 12 + extract(month from w.last_month)::int)
          - (extract(year from ck.period)::int * 12 + extract(month from ck.period)::int)) * r.rate, 2)
      end as accrued,
      coalesce(ck.n1_taken + ck.n_taken, 0) + coalesce((
        select sum(case when c.part = 'full' then 1 else 0.5 end)   -- half-day weighting
        from public.cra_entries c
        where c.employee_id = w.id and c.status = r.status
          and (ck.employee_id is null or c.day >= (ck.period + interval '1 month')::date)
      ), 0) as consumed
  ) b
$$;

notify pgrst, 'reload schema';
