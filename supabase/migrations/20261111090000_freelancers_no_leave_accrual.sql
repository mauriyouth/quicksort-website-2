-- Freelancers (contract_type = 'Freelance') do not accrue paid leave (CP) or
-- RTT through QuickSort, so they get no balance rows and the UIs hide the
-- solde widgets for them. Also expose contract_type on cra_context so the
-- CRA screen can tell freelancers apart without a second round-trip.

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

-- CRA context gains contract_type so the screen can hide the leave balance
-- for freelancers. Old parses degrade via a TS-side zod default.
create or replace function public.cra_context() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'full_name',p.full_name,'role',e.role,'contract_type',e.contract_type,'start_date',e.start_date,'end_date',e.end_date) order by p.full_name,e.start_date desc)
   from public.employees e join public.hr_people p on p.id=e.person_id where private.cra_access(e.id)),'[]'),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,'project_id',a.project_id,'start_date',a.start_date,'end_date',a.end_date,'status',a.status,'title',p.title,'client_name',c.name))
   from public.employee_project_assignments a join public.sales_projects p on p.id=a.project_id join public.sales_clients c on c.id=p.client_id where private.cra_access(a.employee_id)),'[]')
 );
$$;

notify pgrst, 'reload schema';
