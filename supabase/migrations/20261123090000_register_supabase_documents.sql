-- Registers the files already kept in Supabase Storage in the document
-- registry, in place (storage_provider 'supabase', provider_file_id
-- "<bucket>/<path>"): nothing moves, so signed contracts keep their hash.
--
-- * Employment contracts count once both parties signed: a generated but
--   unsigned contract is a draft, not a filed contract. A newer signed
--   contract for the same person supersedes the previous one.
-- * Candidate uploads (identity, qualification, other) only carry a coarse
--   category, so they arrive as needs_review for HR to classify (type and
--   expiry). Resumes are not administrative documents and stay out.
-- * A candidate deleting an upload archives its registry row.
--
-- Triggers keep both sources in sync from now on; the backfill at the end
-- registers what exists today. Rows are inserted directly (no hr_events
-- entry): they record files, not HR decisions.

create function private.mime_from_name(name text) returns text language sql immutable set search_path='' as $$
  select case lower(substring(name from '\.([A-Za-z0-9]+)$'))
    when 'pdf' then 'application/pdf'
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else '' end
$$;
revoke all on function private.mime_from_name(text) from public;

create function private.sync_contract_document(contract uuid) returns void language plpgsql security definer set search_path='' as $$
declare
  c public.contracts;
  signed_on timestamptz;
  code text;
  prev uuid;
  doc uuid;
begin
  select * into c from public.contracts where id = contract;
  if not found or c.person_id is null then return; end if;
  select greatest(s.signed_at, x.signed_at) into signed_on
    from public.contract_signatures s join public.contract_countersignatures x on x.contract_id = s.contract_id
   where s.contract_id = c.id;
  if signed_on is null then return; end if;
  if exists (select 1 from public.documents where storage_provider = 'supabase' and provider_file_id = 'contracts/' || c.storage_path) then return; end if;
  code := case when (select contract_type from public.offers where id = c.offer_id) = 'Freelance' then 'FREELANCE_CONTRACT' else 'EMPLOYMENT_CONTRACT' end;
  select id into prev from public.documents
   where person_id = c.person_id and type_code = code and status = 'active'
   order by created_at desc limit 1;
  insert into public.documents (type_code, owner_kind, person_id, title, issued_on, storage_provider, provider_file_id, file_name, mime_type, sha256, created_at)
  values (code, 'person', c.person_id, c.title, (signed_on at time zone 'Europe/Paris')::date, 'supabase', 'contracts/' || c.storage_path,
          coalesce(nullif(substring(c.storage_path from '[^/]+$'), ''), c.title || '.pdf'), 'application/pdf', c.document_sha256, c.created_at)
  returning id into doc;
  if prev is not null then
    update public.documents set status = 'superseded', superseded_by = doc where id = prev;
  end if;
end; $$;
revoke all on function private.sync_contract_document(uuid) from public;

create function private.contract_signed_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.sync_contract_document(new.contract_id);
  return new;
end; $$;
revoke all on function private.contract_signed_trigger() from public;
create trigger contract_signature_document after insert on public.contract_signatures
  for each row execute function private.contract_signed_trigger();
create trigger contract_countersignature_document after insert on public.contract_countersignatures
  for each row execute function private.contract_signed_trigger();

-- Contracts generated before person links existed get their person_id later.
create function private.contract_person_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.sync_contract_document(new.id);
  return new;
end; $$;
revoke all on function private.contract_person_trigger() from public;
create trigger contract_person_document after update of person_id on public.contracts
  for each row when (old.person_id is null and new.person_id is not null) execute function private.contract_person_trigger();

create function private.sync_candidate_document(upload uuid) returns void language plpgsql security definer set search_path='' as $$
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
  on conflict (storage_provider, provider_file_id) do nothing;
end; $$;
revoke all on function private.sync_candidate_document(uuid) from public;

create function private.candidate_document_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' then
    update public.documents set status = 'archived', notes = notes || ' Deleted by the candidate.'
     where storage_provider = 'supabase' and provider_file_id = 'candidate-documents/' || old.storage_path and status = 'active';
    return old;
  end if;
  perform private.sync_candidate_document(new.id);
  return new;
end; $$;
revoke all on function private.candidate_document_trigger() from public;
create trigger candidate_document_registry after insert or delete on public.candidate_documents
  for each row execute function private.candidate_document_trigger();

-- Linking a candidate account to an HR person brings their uploads and contracts along.
create function private.person_account_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select id from public.candidate_documents where candidate_id = new.profile_id loop
    perform private.sync_candidate_document(r.id);
  end loop;
  return new;
end; $$;
revoke all on function private.person_account_trigger() from public;
create trigger person_account_documents after insert on public.hr_person_accounts
  for each row execute function private.person_account_trigger();

-- Backfill, oldest first so later contracts supersede earlier ones.
do $$
declare r record;
begin
  for r in select id from public.contracts order by created_at loop
    perform private.sync_contract_document(r.id);
  end loop;
  for r in select id from public.candidate_documents order by created_at loop
    perform private.sync_candidate_document(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
