-- Moving a wrongly filed payslip to the right person. The file keeps its
-- storage id, so one storage file may back an archived row and an active one:
-- uniqueness now applies to live rows only.
alter table public.documents drop constraint documents_storage_provider_provider_file_id_key;
create unique index documents_file_live on public.documents(storage_provider, provider_file_id) where status <> 'archived';

-- Its ON CONFLICT clause must name the partial index predicate.
create or replace function private.sync_candidate_document(upload uuid) returns void language plpgsql security definer set search_path='' as $$
declare
  d public.candidate_documents;
  person uuid;
begin
  select * into d from public.candidate_documents where id = upload;
  if not found or d.category = 'resume' then return; end if;
  select person_id into person from public.hr_person_accounts where profile_id = d.candidate_id;
  if person is null then return; end if;
  insert into public.documents (type_code, owner_kind, person_id, title, needs_review, notes, storage_provider, provider_file_id,
                                file_name, mime_type, size_bytes, uploaded_by, created_at)
  values (case d.category when 'qualification' then 'DIPLOMA' else 'OTHER' end, 'person', person,
          case when d.category = 'identity' then 'Pièce d''identité — à classer' else d.name end,
          true, 'Uploaded by the candidate (' || d.category || ').', 'supabase', 'candidate-documents/' || d.storage_path,
          d.name, private.mime_from_name(d.name), d.size_bytes, d.candidate_id, d.created_at)
  on conflict (storage_provider, provider_file_id) where status <> 'archived' do nothing;
end; $$;
revoke all on function private.sync_candidate_document(uuid) from public;

-- The caller has already moved the file in storage into to_folder_id. Archives
-- the old row and registers the new one atomically; both people get an audit event.
create function public.move_payslip(document_id uuid, to_person_id uuid, to_folder_id text, request_id uuid default gen_random_uuid())
returns public.documents language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  old_doc public.documents;
  new_doc public.documents;
  old_name text;
  new_name text;
begin
  if actor is null then raise exception 'Authentication is required.'; end if;
  if not private.hr_operator() then raise exception 'Not allowed to move payslips.'; end if;
  select * into old_doc from public.documents d where d.id = document_id for update;
  if not found or old_doc.type_code <> 'PAYSLIP' or old_doc.status <> 'active' then raise exception 'Only an active payslip can be moved.'; end if;
  if to_person_id is not distinct from old_doc.person_id then raise exception 'Choose a different person.'; end if;
  select full_name into new_name from public.hr_people where id = to_person_id;
  if not found then raise exception 'Person not found.'; end if;
  select full_name into old_name from public.hr_people where id = old_doc.person_id;
  select email into actor_email from public.profiles where id = actor;

  update public.documents d set status = 'archived', notes = 'Moved to ' || new_name where d.id = old_doc.id;
  insert into public.documents (
    type_code, owner_kind, person_id, title, issued_on, valid_from, notes, storage_provider, provider_file_id,
    provider_folder_id, file_name, mime_type, size_bytes, sha256, uploaded_by
  ) values (
    old_doc.type_code, 'person', to_person_id, old_doc.title, old_doc.issued_on, old_doc.valid_from,
    'Moved from ' || old_name, old_doc.storage_provider, old_doc.provider_file_id,
    to_folder_id, old_doc.file_name, old_doc.mime_type, old_doc.size_bytes, old_doc.sha256, actor
  ) returning * into new_doc;

  insert into public.hr_events (person_id, kind, previous_state, next_state, actor_id, actor_email, rationale, request_id)
  values (old_doc.person_id, 'document_moved', old_doc.id::text, new_doc.id::text, actor, coalesce(actor_email, ''), 'Payslip moved to ' || new_name, request_id),
         (to_person_id, 'document_moved', old_doc.id::text, new_doc.id::text, actor, coalesce(actor_email, ''), 'Payslip moved from ' || old_name, request_id);
  return new_doc;
end; $$;
revoke all on function public.move_payslip(uuid, uuid, text, uuid) from public;
grant execute on function public.move_payslip(uuid, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
