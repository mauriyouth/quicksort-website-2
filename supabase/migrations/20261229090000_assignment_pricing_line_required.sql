-- Every assignment on a project with pricing lines names its line.
--
-- Assignments saved without a line (person record → assign, when no line
-- was picked) were billed on the project's only line by invoicing, but the
-- project staffing view and the yearly billable cap matched lines by name
-- and ignored them. The six existing rows were backfilled by hand; this
-- trigger keeps new ones consistent:
-- - no line, project has exactly one line → that line;
-- - no line, project has several lines   → rejected, pick one.
-- The one-person-per-line rule in hr_command only runs when a line is sent,
-- so it is checked again here once the line is filled in.
create or replace function public.employee_assignment_pricing_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lines jsonb;
begin
  if coalesce(new.pricing_line, '') <> '' then return new; end if;
  -- Updates that leave the project and line alone keep legacy rows editable.
  if tg_op = 'UPDATE' and new.project_id = old.project_id and coalesce(old.pricing_line, '') = '' then return new; end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb) into lines
  from public.sales_projects p,
       jsonb_array_elements(case when jsonb_typeof(p.tjm_profiles) = 'array' then p.tjm_profiles else '[]'::jsonb end) l
  where p.id = new.project_id and coalesce(l->>'name', '') <> '';
  if jsonb_array_length(lines) = 0 then
    new.pricing_line := '';
    return new;
  end if;
  if jsonb_array_length(lines) > 1 then
    raise exception 'Pick the pricing line this person is billed on.';
  end if;
  new.pricing_line := lines->0->>'name';
  if new.status in ('proposed', 'reserved', 'confirmed', 'active') and exists (
    select 1 from public.employee_project_assignments a
    where a.project_id = new.project_id and a.pricing_line = new.pricing_line
      and a.status in ('proposed', 'reserved', 'confirmed', 'active') and a.id is distinct from new.id
  ) then
    raise exception 'This profile line already has someone assigned. Release the current staffing before assigning someone else.';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_assignment_pricing_line on public.employee_project_assignments;
create trigger employee_assignment_pricing_line
  before insert or update of pricing_line, project_id on public.employee_project_assignments
  for each row execute function public.employee_assignment_pricing_line();
