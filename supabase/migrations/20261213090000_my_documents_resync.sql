-- 20261211090000_my_documents was edited after an early draft of it had
-- already been applied, so the deployed my_documents still had the draft
-- shape (only the employee's own uploads, without title or file columns) and
-- own_document_download_source never existed. This re-applies the final
-- version: HR-filed documents show in the portal and can be opened.
-- The column set changes, so the view is dropped rather than replaced.
drop view if exists public.my_documents;

create view public.my_documents as
  select d.id,
         case when d.uploaded_by = private.workspace_user_id() and d.provider_file_id like 'candidate-documents/%'
              then substring(d.provider_file_id from length('candidate-documents/') + 1) end as upload_path,
         d.uploaded_by = private.workspace_user_id() as uploaded_by_me,
         d.type_code,
         t.label as type_label,
         d.title,
         d.file_name,
         d.mime_type,
         d.size_bytes,
         d.status,
         d.needs_review,
         d.issued_on,
         d.expires_on,
         coalesce(t.warn_days, '{}'::int[]) as warn_days,
         d.created_at
    from public.documents d
    left join public.document_types t on t.code = d.type_code
   where d.owner_kind = 'person'
     and d.type_code <> 'PAYSLIP'
     and (d.status = 'active' or d.uploaded_by = private.workspace_user_id())
     and exists (select 1 from public.hr_person_accounts m
                  where m.person_id = d.person_id and m.profile_id = private.workspace_user_id());
revoke all on public.my_documents from public;
grant select on public.my_documents to authenticated;

-- Download source for a document of the caller's own HR folder (the same rows
-- as my_documents). Logs the access like payslip_download_source.
create or replace function public.own_document_download_source(document_id uuid)
returns table(provider_file_id text, file_name text, mime_type text, size_bytes bigint, storage_provider text, encrypted_credentials text)
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  doc public.documents;
begin
  if actor is null then return; end if;
  select * into doc from public.documents d
   where d.id = document_id and d.owner_kind = 'person' and d.type_code <> 'PAYSLIP'
     and (d.status = 'active' or d.uploaded_by = actor)
     and exists (select 1 from public.hr_person_accounts m where m.person_id = d.person_id and m.profile_id = actor);
  if not found then return; end if;
  select email into actor_email from public.profiles where id = actor;
  insert into public.hr_events (person_id, kind, next_state, actor_id, actor_email, request_id)
  values (doc.person_id, 'document_accessed', doc.id::text, actor, coalesce(actor_email, ''), gen_random_uuid());
  return query
    select doc.provider_file_id, doc.file_name, doc.mime_type, doc.size_bytes, doc.storage_provider,
           case when doc.storage_provider = 'gdrive'
                then (select s.encrypted_credentials from public.google_drive_settings s order by s.updated_at desc limit 1) end;
end; $$;
revoke all on function public.own_document_download_source(uuid) from public;
grant execute on function public.own_document_download_source(uuid) to authenticated;

notify pgrst, 'reload schema';
