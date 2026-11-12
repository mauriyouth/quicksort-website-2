-- One-off backfill: when a consultant-month was billed in full, record it in the CRA.
--
-- A consultant-month (employee, project, month) is "billed in full" when its
-- non-canceled, non-ignored invoices (CRA or imported from Qonto) either bill a
-- monthly unit ("mois"/"month"), or bill at least as many days as there are
-- working days that month (Mon–Fri, minus French public holidays) inside the
-- employment period and a confirmed/active/completed staffing on that project.
--
-- Only CRA months that are not filled yet (no entry at all for that person and
-- month) are touched: each of those working days becomes a full "client_project"
-- day on that project. A CRA month with any entry already is left as it is.
-- Safe to re-run: a filled month is skipped on the next pass.
--
-- Dry run (read-only) before applying: run everything up to and including the
-- `create temp table ... cra_backfill_days` statement, then
--   select employee_id, project_id, month, count(*) from cra_backfill_days group by 1,2,3 order by 3,1;

create temp table cra_backfill_months as
with billed as (
  select i.employee_id, i.project_id, i.period_month as month,
    coalesce(sum(l.quantity) filter (where l.unit ~* '^\s*(j|day)' or btrim(coalesce(l.unit, '')) = ''), 0) as billed_days,
    coalesce(bool_or(l.unit ~* '^\s*(mois|month)'), false) as monthly
  from public.invoices i
  join public.invoice_lines l on l.invoice_id = i.id
  where i.status <> 'canceled' and not i.ignored
    and i.employee_id is not null and i.project_id is not null and i.period_month is not null
  group by 1, 2, 3
),
-- Easter Sunday per year (anonymous Gregorian algorithm), for the movable holidays.
years as (
  select distinct extract(year from month)::int as y from billed
),
easter as (
  select y, make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1) as sunday
  from (
    select y, h, l, (a + 11 * h + 22 * l) / 451 as m
    from (
      select y, a, h, (32 + 2 * e + 2 * i - h - k) % 7 as l
      from (
        select y, a, e, i, k, (19 * a + b - d - g + 15) % 30 as h
        from (
          select y, y % 19 as a, y / 100 as b, (y / 100) / 4 as d, (y / 100) % 4 as e,
            ((y / 100) - ((y / 100) + 8) / 25 + 1) / 3 as g, (y % 100) / 4 as i, (y % 100) % 4 as k
          from years
        ) s1
      ) s2
    ) s3
  ) s4
),
holidays as (
  select make_date(y, 1, 1) as day from years union all
  select make_date(y, 5, 1) from years union all
  select make_date(y, 5, 8) from years union all
  select make_date(y, 7, 14) from years union all
  select make_date(y, 8, 15) from years union all
  select make_date(y, 11, 1) from years union all
  select make_date(y, 11, 11) from years union all
  select make_date(y, 12, 25) from years union all
  select sunday + 1 from easter union all
  select sunday + 39 from easter union all
  select sunday + 50 from easter
),
staffed_days as (
  select b.employee_id, b.project_id, b.month, d::date as day, b.billed_days, b.monthly
  from billed b
  join public.employees emp on emp.id = b.employee_id
  cross join lateral generate_series(b.month, (b.month + interval '1 month' - interval '1 day')::date, interval '1 day') d
  where extract(isodow from d) < 6
    and d::date not in (select day from holidays)
    and d::date >= emp.start_date and (emp.end_date is null or d::date <= emp.end_date)
    and exists (
      select 1 from public.employee_project_assignments a
      where a.employee_id = b.employee_id and a.project_id = b.project_id
        and a.status in ('confirmed', 'active', 'completed')
        and a.start_date <= d::date and (a.end_date is null or a.end_date >= d::date)
    )
)
select employee_id, project_id, month, array_agg(day order by day) as days
from staffed_days
group by employee_id, project_id, month, billed_days, monthly
having monthly or billed_days >= count(*);

create temp table cra_backfill_days as
select distinct on (m.employee_id, d.day) m.employee_id, m.project_id, m.month, d.day
from cra_backfill_months m
cross join lateral unnest(m.days) as d(day)
where not exists (select 1 from public.cra_entries e where e.employee_id = m.employee_id and e.month = m.month)
order by m.employee_id, d.day, m.project_id;

insert into public.cra_months (employee_id, month)
select distinct employee_id, month from cra_backfill_days
on conflict do nothing;

insert into public.cra_entries (employee_id, month, day, part, status, project_id)
select employee_id, month, day, 'full', 'client_project', project_id from cra_backfill_days;

update public.cra_months m
set version = m.version + 1, updated_at = now()
where exists (select 1 from cra_backfill_days b where b.employee_id = m.employee_id and b.month = m.month);

drop table cra_backfill_days;
drop table cra_backfill_months;
