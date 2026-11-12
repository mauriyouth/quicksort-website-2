-- Paid leave (CP) is acquired at the end of each worked month, not at its
-- start: the current month only counts once it is over. An ended employment
-- still acquires its final (possibly partial) month once the end date has
-- passed. RTT keeps accruing from the start of the month, and the balance
-- rows still exist from the start month on (CP then shows 0 accrued).

create or replace function public.employee_leave_balances() returns setof public.leave_balance
language sql stable security definer set search_path='' as $$
  with bounds as (
    -- RTT window: start month … min(current month, end month).
    -- CP window:  start month … last completed month (or the end month once
    --             the employment has ended).
    select e.id,
      date_trunc('month', e.start_date)::date as first_month,
      date_trunc('month', least(current_date, coalesce(e.end_date, current_date)))::date as last_month,
      case when e.end_date < current_date then date_trunc('month', e.end_date)::date
        else (date_trunc('month', current_date) - interval '1 month')::date
      end as cp_last_month
    from public.employees e
    where private.cra_access(e.id)          -- HR operator or the employee themself
      and e.contract_type <> 'Freelance'    -- freelancers accrue no CP/RTT
  ), windows as (
    select id, last_month, cp_last_month,
      (extract(year from last_month)::int * 12 + extract(month from last_month)::int)
      - (extract(year from first_month)::int * 12 + extract(month from first_month)::int) + 1 as months,
      greatest(0,
        (extract(year from cp_last_month)::int * 12 + extract(month from cp_last_month)::int)
      - (extract(year from first_month)::int * 12 + extract(month from first_month)::int) + 1) as cp_months
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
      case when ck.employee_id is null then round((case when r.kind = 'cp' then w.cp_months else w.months end) * r.rate, 2)
        -- Payslip figures, then the completed months after the payslip month.
        else ck.n1_acquired + ck.n_acquired + round(greatest(0,
            (extract(year from w.cp_last_month)::int * 12 + extract(month from w.cp_last_month)::int)
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
