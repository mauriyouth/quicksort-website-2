-- CRA consumption totals for the Projects screen, aggregated in the database.
-- The screen used to page every client_project CRA entry (all years, all
-- employees) into the browser and sum it there; this returns only the totals:
--  * projects: all-time days per project (a full day = 1, am/pm = 0.5)
--  * lines: target_year days per project and pricing line, a day attributed to
--    the employee's earliest-starting confirmed/active/completed assignment on
--    that project whose window covers it (same rules as the client did).
-- Rows are filtered with private.cra_access, mirroring the cra_entries RLS
-- policy, so callers see exactly the totals of the entries they could read.
create or replace function public.sales_project_cra_consumption(target_year integer)
returns jsonb language sql stable security definer set search_path='' as $$
 with entries as (
  select c.project_id, c.employee_id, c.day, c.month,
   (case when c.part in ('am','pm') then 0.5 else 1 end)::numeric as days
  from public.cra_entries c
  where c.status='client_project' and c.project_id is not null
   and private.cra_access(c.employee_id)
 ),
 per_project as (
  select project_id, sum(days) as days from entries group by project_id
 ),
 per_line as (
  select e.project_id, l.pricing_line, sum(e.days) as days
  from entries e
  cross join lateral (
   select a.pricing_line from public.employee_project_assignments a
   where a.employee_id=e.employee_id and a.project_id=e.project_id
    and a.status in ('confirmed','active','completed') and a.pricing_line<>''
    and a.start_date<=e.day and (a.end_date is null or a.end_date>=e.day)
   order by a.start_date limit 1
  ) l
  where extract(year from e.month)=target_year
  group by e.project_id, l.pricing_line
 )
 select jsonb_build_object(
  'projects',coalesce((select jsonb_agg(jsonb_build_object('project_id',project_id,'days',days)) from per_project),'[]'),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('project_id',project_id,'pricing_line',pricing_line,'days',days)) from per_line),'[]')
 );
$$;
revoke all on function public.sales_project_cra_consumption(integer) from public, anon;
grant execute on function public.sales_project_cra_consumption(integer) to authenticated;
