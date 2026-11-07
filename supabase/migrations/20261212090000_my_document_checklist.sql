-- The portal's "My documents" mirrors the HR checklist of the person page:
-- the documents required for the employee's contract (and a residence permit
-- outside the EU), which are filed, expiring, expired or missing, with an
-- upload straight into the missing slot.
--
-- * my_document_types lists the person document types with the caller's
--   requirement flag, computed like the admin page: the contract type of each
--   employment that is not ended (as the HR page), plus 'non_eu' when the nationality needs a
--   residence permit. self_upload marks the types an employee may file
--   themselves; contracts, exit documents, payslips and the photo stay HR's.
-- * candidate_documents.type_code carries the slot an upload was made for.
--   The registry row then gets that type straight away (still needs_review,
--   so HR verifies it and sets its validity) instead of OTHER "à classer".

create view public.my_document_types as
  with tokens as (
    select e.contract_type as token
      from public.employees e
     where e.contract_type is not null and e.contract_type <> ''
       and e.status <> 'ended'
       and exists (select 1 from public.hr_person_accounts m where m.person_id = e.person_id and m.profile_id = private.workspace_user_id())
    union
    select 'non_eu'
      from public.employees e
     where private.needs_residence_permit(e.nationality)
       and e.status <> 'ended'
       and exists (select 1 from public.hr_person_accounts m where m.person_id = e.person_id and m.profile_id = private.workspace_user_id())
  )
  select t.code,
         t.label,
         t.folder,
         t.requirement_group,
         t.requires_expiry,
         t.warn_days,
         t.sensitive,
         t.position,
         t.required_for && coalesce((select array_agg(token) from tokens), '{}') as required,
         t.code not in ('EMPLOYMENT_CONTRACT', 'EMPLOYMENT_AVENANT', 'FREELANCE_CONTRACT', 'EXIT_DOCUMENT', 'PAYSLIP', 'PHOTO') as self_upload
    from public.document_types t
   where 'person' = any(t.owner_kinds) and t.code <> 'PAYSLIP';
revoke all on public.my_document_types from public;
grant select on public.my_document_types to authenticated;

alter table public.candidate_documents add column type_code text references public.document_types(code);

-- Only person types an employee may file themselves.
create function private.candidate_document_type_check() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.type_code is not null and (
       new.type_code in ('EMPLOYMENT_CONTRACT', 'EMPLOYMENT_AVENANT', 'FREELANCE_CONTRACT', 'EXIT_DOCUMENT', 'PAYSLIP', 'PHOTO')
       or not exists (select 1 from public.document_types t where t.code = new.type_code and 'person' = any(t.owner_kinds))) then
    raise exception 'This document type cannot be uploaded from the portal.';
  end if;
  return new;
end; $$;
revoke all on function private.candidate_document_type_check() from public;
create trigger candidate_document_type before insert on public.candidate_documents
  for each row execute function private.candidate_document_type_check();

create or replace function private.sync_candidate_document(upload uuid) returns void language plpgsql security definer set search_path='' as $$
declare
  d public.candidate_documents;
  person uuid;
  type_label text;
begin
  select * into d from public.candidate_documents where id = upload;
  if not found or d.category = 'resume' then return; end if;
  select person_id into person from public.hr_person_accounts where profile_id = d.candidate_id;
  if person is null then return; end if;
  if d.type_code is not null then
    select label into type_label from public.document_types where code = d.type_code;
  end if;
  insert into public.documents (type_code, owner_kind, person_id, title, needs_review, notes, storage_provider, provider_file_id,
                                file_name, mime_type, size_bytes, uploaded_by, created_at)
  values (coalesce(d.type_code, case d.category when 'qualification' then 'DIPLOMA' else 'OTHER' end), 'person', person,
          case when type_label is not null then type_label
               when d.category = 'identity' then 'Pièce d''identité — à classer'
               else d.name end,
          true,
          case when type_label is not null then 'Uploaded by the employee as ' || type_label || '.'
               else 'Uploaded by the candidate (' || d.category || ').' end,
          'supabase', 'candidate-documents/' || d.storage_path,
          d.name, private.mime_from_name(d.name), d.size_bytes, d.candidate_id, d.created_at)
  on conflict (storage_provider, provider_file_id) where status <> 'archived' do nothing;
end; $$;
revoke all on function private.sync_candidate_document(uuid) from public;

notify pgrst, 'reload schema';
