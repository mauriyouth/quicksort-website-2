-- Auto-extend open staffing commitments when the underlying contract is renewed.
-- Signing a project extension (sales.md §14) renews the delivery contract, so
-- open confirmed/active assignments on that project follow the furthest signed
-- extension end date — the same rule that moves the project end date
-- (ProjectExtensions.tsx syncProjectEndDate). The move mirrors hr_command's
-- capacity guard: an automatic extension can never push a day over 100%
-- allocation; conflicting commitments are left untouched for manual staffing
-- review. Moves are forward-only — un-signing, shortening or deleting an
-- extension never rolls assignments or the project end date back. Each
-- automatic move is recorded in hr_events with the signing actor.

create function private.extend_assignments_on_project_extension() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  furthest date;
  actor uuid := private.workspace_user_id();
  actor_email text;
  project record;
  a record;
  over_capacity boolean;
begin
  if new.status is distinct from 'signed' or new.end_date is null then return new; end if;
  select max(e.end_date) into furthest from public.sales_project_extensions e
   where e.project_id = new.project_id and e.status = 'signed';
  if furthest is null then return new; end if;
  select * into project from public.sales_projects where id = new.project_id;
  -- The contract end follows the furthest signed extension (only forward).
  if project.end_date is null or furthest > project.end_date then
    update public.sales_projects set end_date = furthest, updated_at = now() where id = new.project_id;
  end if;
  if actor is not null then select p.email into actor_email from public.profiles p where p.id = actor; end if;
  for a in
    select * from public.employee_project_assignments
     where project_id = new.project_id
       and status in ('confirmed','active')
       and end_date is not null and end_date < furthest
     order by start_date
  loop
    -- Capacity guard (same boundary rule as hr_command): the extension must
    -- not push total allocation over 100% on any day of the new segment.
    select exists(
      with bounds as (
        select a.end_date + 1 as day
        union
        select b.start_date from public.employee_project_assignments b
         where b.employee_id = a.employee_id and b.id <> a.id
           and b.status in ('reserved','confirmed','active','completed')
           and b.start_date > a.end_date and b.start_date <= furthest
      )
      select 1 from bounds
      where a.allocation_pct + coalesce((
        select sum(b.allocation_pct) from public.employee_project_assignments b
         where b.employee_id = a.employee_id and b.id <> a.id
           and b.status in ('reserved','confirmed','active','completed')
           and b.start_date <= bounds.day
           and coalesce(b.end_date, 'infinity'::date) >= bounds.day), 0) > 100
    ) into over_capacity;
    if over_capacity then continue; end if;
    update public.employee_project_assignments
       set end_date = furthest, version = version + 1, updated_at = now()
     where id = a.id;
    if actor is not null and actor_email is not null then
      insert into public.hr_events(person_id, employee_id, kind, previous_state, next_state, actor_id, actor_email, rationale, request_id)
      values((select e2.person_id from public.employees e2 where e2.id = a.employee_id), a.employee_id,
        'assignment_auto_extended', a.end_date::text, furthest::text, actor, actor_email,
        'Contract renewed (signed extension on ' || coalesce(project.title, '') || '); assignment end moved from ' || a.end_date::text || ' to ' || furthest::text || '.',
        gen_random_uuid());
    end if;
  end loop;
  return new;
end;
$$;

create trigger project_extension_extends_assignments
  after insert or update of status, end_date on public.sales_project_extensions
  for each row execute function private.extend_assignments_on_project_extension();

revoke all on function private.extend_assignments_on_project_extension() from public;
