-- Payslips (bulletins de paie). Each Silae payslip is a PAYSLIP document of a
-- person; the employee reads their own through my_payslips and
-- payslip_download_source, never through the registry (its RLS is unchanged).
-- The matricule now identifies a person, not an employment row: a person who
-- returns after leaving keeps the same number across employments.
insert into public.document_types (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values ('PAYSLIP', 'Bulletin de paie', '{person}', 'bulletins', false, null, '{}', true, '{}', null, 80);

alter table public.employees drop constraint employees_matricule_key;
create index employees_matricule on public.employees(matricule);

-- Serialises concurrent claims of one matricule, then refuses it when another
-- person already holds it.
create function private.employees_matricule_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare holder text;
begin
  perform pg_advisory_xact_lock(hashtext(new.matricule));
  select p.full_name into holder from public.employees e join public.hr_people p on p.id = e.person_id
   where e.matricule = new.matricule and e.person_id <> new.person_id limit 1;
  if found then raise exception 'Matricule % already belongs to %.', new.matricule, holder; end if;
  return new;
end; $$;
revoke all on function private.employees_matricule_owner() from public;
create trigger employees_matricule_owner before insert or update of matricule, person_id on public.employees
  for each row execute function private.employees_matricule_owner();

create function public.set_employee_matricule(employee_id uuid, matricule text, request_id uuid default gen_random_uuid())
returns public.employees language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  m text := trim(coalesce(matricule, ''));
  emp public.employees;
  prev text;
begin
  if actor is null or not private.hr_operator() then raise exception 'Not allowed to change matricules.'; end if;
  if m !~ '^[A-Za-z0-9-]{1,20}$' then raise exception 'Matricule must be 1 to 20 letters, digits or dashes.'; end if;
  select * into emp from public.employees e where e.id = employee_id for update;
  if not found then raise exception 'Employment not found.'; end if;
  prev := emp.matricule;
  update public.employees e set matricule = m, version = e.version + 1, updated_at = now() where e.id = employee_id returning * into emp;
  select email into actor_email from public.profiles where id = actor;
  insert into public.hr_events (person_id, employee_id, kind, previous_state, next_state, actor_id, actor_email, request_id)
  values (emp.person_id, emp.id, 'matricule_changed', prev, m, actor, coalesce(actor_email, ''), request_id);
  return emp;
end; $$;
revoke all on function public.set_employee_matricule(uuid, text, uuid) from public;
grant execute on function public.set_employee_matricule(uuid, text, uuid) to authenticated;

-- Owner-run like my_employment: no employment-status filter, so leavers keep
-- access to their payslips.
create view public.my_payslips as
  select d.id, d.person_id, d.title, d.valid_from, d.file_name, d.size_bytes, d.created_at
  from public.documents d
  where d.type_code = 'PAYSLIP' and d.status = 'active'
    and exists (select 1 from public.hr_person_accounts m where m.person_id = d.person_id and m.profile_id = private.workspace_user_id());
revoke all on public.my_payslips from public;
grant select on public.my_payslips to authenticated;

create function public.payslip_download_source(document_id uuid)
returns table(provider_file_id text, file_name text, mime_type text, size_bytes bigint, storage_provider text, encrypted_credentials text)
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  doc public.documents;
begin
  if actor is null then return; end if;
  select * into doc from public.documents d
   where d.id = document_id and d.type_code = 'PAYSLIP' and d.status = 'active'
     and exists (select 1 from public.hr_person_accounts m where m.person_id = d.person_id and m.profile_id = actor);
  if not found then return; end if;
  select email into actor_email from public.profiles where id = actor;
  insert into public.hr_events (person_id, kind, next_state, actor_id, actor_email, request_id)
  values (doc.person_id, 'document_accessed', doc.id::text, actor, coalesce(actor_email, ''), gen_random_uuid());
  return query
    select doc.provider_file_id, doc.file_name, doc.mime_type, doc.size_bytes, doc.storage_provider,
           (select s.encrypted_credentials from public.google_drive_settings s order by s.updated_at desc limit 1);
end; $$;
revoke all on function public.payslip_download_source(uuid) from public;
grant execute on function public.payslip_download_source(uuid) to authenticated;

notify pgrst, 'reload schema';
