-- Business plan: structure staff get a period. Empty start = hire date, empty
-- end = exit date. Outside the period the person counts as a consultant; inside
-- it, any month with a mission also counts them as a consultant (computed).
alter table public.business_plan_structure
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.business_plan_structure
  drop constraint if exists business_plan_structure_period_check;
alter table public.business_plan_structure
  add constraint business_plan_structure_period_check
  check (start_date is null or end_date is null or end_date >= start_date);
