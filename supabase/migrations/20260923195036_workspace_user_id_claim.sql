-- Clerk reserves the `sub` claim (always the Clerk user id), so the workspace user
-- id (uuid) travels in a custom claim instead: user_metadata.user_id (Clerk JWT
-- template). This migration centralizes identity resolution in one function that
-- falls back to `sub`, keeping email/password sessions (uuid sub) working.
create or replace function private.workspace_user_id() returns uuid
language plpgsql stable
set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  raw text;
begin
  if claims is null then return null; end if;
  raw := coalesce(
    claims ->> 'workspace_user_id',
    claims #>> '{user_metadata,user_id}',
    claims ->> 'sub'
  );
  if raw is null or raw = '' then return null; end if;
  begin
    return raw::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;
revoke all on function private.workspace_user_id() from public;
grant execute on function private.workspace_user_id() to authenticated, anon;

-- Functions that resolved identity through auth.uid().
create or replace function private.is_admin() returns boolean language sql stable security definer
set search_path = '' as $$
  select private.workspace_user_id() is not null and exists (
    select 1 from public.user_roles where user_id = private.workspace_user_id() and role = 'admin'
  );
$$;

create or replace function private.record_signature() returns trigger language plpgsql security invoker
set search_path = '' as $$
begin
  if private.workspace_user_id() is null then raise exception 'Authentication required'; end if;
  select c.document_sha256 into new.document_sha256 from public.contracts c
    where c.id = new.contract_id and c.candidate_id = private.workspace_user_id();
  if not found then raise exception 'Contract not available'; end if;
  new.candidate_id := private.workspace_user_id();
  new.signed_at := now();
  new.consent_text := 'I have read this contract and agree to sign it electronically.';
  return new;
end;
$$;

create or replace function public.sync_clerk_profile() returns text
language plpgsql security definer
set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_id uuid := private.workspace_user_id();
  v_email text;
  v_name text;
begin
  if claims is null then raise exception 'Authentication required'; end if;
  if v_id is null then
    raise exception 'The Clerk token must carry the workspace user id (uuid) in user_metadata.user_id';
  end if;
  v_email := left(coalesce(claims ->> 'email', ''), 200);
  v_name := left(coalesce(claims -> 'user_metadata' ->> 'full_name', claims ->> 'name', ''), 200);

  -- profiles.id is keyed to auth.users; create the shadow auth user once.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_id, nullif(v_email, ''), now(), jsonb_build_object('full_name', v_name))
  on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name)
  values (v_id, v_email, v_name)
  on conflict (id) do update set email = excluded.email;

  insert into public.user_roles (user_id, role) values (v_id, 'candidate')
  on conflict (user_id) do nothing;

  return v_id::text;
end;
$$;

create or replace function public.review_admin_access(target_email text, decision text) returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := private.workspace_user_id();
  v_target uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.portal_owners where user_id = v_actor) then
    raise exception 'Only workspace owners can review admin access';
  end if;
  if decision not in ('approved', 'rejected', 'revoked') then
    raise exception 'Unknown access decision';
  end if;
  select id into v_target from public.profiles
    where lower(email) = lower(trim(target_email)) limit 1;
  if v_target is null then raise exception 'No workspace account for %', target_email; end if;
  if v_target = v_actor then raise exception 'Owners cannot review their own access'; end if;
  if decision = 'revoked' and exists (select 1 from public.portal_owners where user_id = v_target) then
    raise exception 'Owner accounts cannot be revoked here';
  end if;

  if decision <> 'rejected' then
    insert into public.user_roles (user_id, role)
    values (v_target, case when decision = 'approved' then 'admin' else 'candidate' end)
    on conflict (user_id) do update set role = excluded.role;
  end if;

  insert into public.admin_access_requests (user_id, status, reviewed_by, reviewed_at)
  values (v_target, decision, v_actor, now())
  on conflict (user_id) do update
    set status = excluded.status, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;

  insert into public.admin_access_audit (actor_id, target_id, action)
  values (v_actor, v_target, decision);
end;
$$;

-- Column defaults that stamped auth.uid().
alter table public.tool_requests alter column candidate_id set default private.workspace_user_id();
alter table public.contract_signatures alter column candidate_id set default private.workspace_user_id();

-- Candidate-facing views.
create or replace view public.my_application as
select c.id, c.full_name, c.stage, c.start_date, c.created_at, c.updated_at
from public.pipeline_candidates c
where c.email = (select p.email from public.profiles p where p.id = (select private.workspace_user_id()));

create or replace view public.my_application_events as
select e.id, e.candidate_id, e.to_stage, e.created_at
from public.pipeline_events e
join public.pipeline_candidates c on c.id = e.candidate_id
where c.email = (select p.email from public.profiles p where p.id = (select private.workspace_user_id()));

-- Policies that referenced auth.uid() directly, re-created against the resolver.
drop policy access_requests_read on public.admin_access_requests;
create policy access_requests_read on public.admin_access_requests for select to authenticated
using (user_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy access_requests_insert on public.admin_access_requests;
create policy access_requests_insert on public.admin_access_requests for insert to authenticated
with check (user_id = (select private.workspace_user_id()) and status = 'pending' and reviewed_by is null and reviewed_at is null);

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (id = (select private.workspace_user_id())) with check (id = (select private.workspace_user_id()));

drop policy roles_read on public.user_roles;
create policy roles_read on public.user_roles for select to authenticated
using (user_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy documents_read on public.candidate_documents;
create policy documents_read on public.candidate_documents for select to authenticated
using (candidate_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy documents_insert on public.candidate_documents;
create policy documents_insert on public.candidate_documents for insert to authenticated
with check (candidate_id = (select private.workspace_user_id()));

drop policy documents_delete on public.candidate_documents;
create policy documents_delete on public.candidate_documents for delete to authenticated
using (candidate_id = (select private.workspace_user_id()));

drop policy contracts_read on public.contracts;
create policy contracts_read on public.contracts for select to authenticated
using (candidate_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy signatures_read on public.contract_signatures;
create policy signatures_read on public.contract_signatures for select to authenticated
using (candidate_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy signatures_insert on public.contract_signatures;
create policy signatures_insert on public.contract_signatures for insert to authenticated
with check (candidate_id = (select private.workspace_user_id()) and exists (
  select 1 from public.contracts c where c.id = contract_id and c.candidate_id = (select private.workspace_user_id())
));

drop policy requests_read on public.tool_requests;
create policy requests_read on public.tool_requests for select to authenticated
using (candidate_id = (select private.workspace_user_id()) or (select private.is_admin()));

drop policy requests_insert on public.tool_requests;
create policy requests_insert on public.tool_requests for insert to authenticated
with check (candidate_id = (select private.workspace_user_id()) and status = 'pending' and admin_note = '');

drop policy candidate_requests_own on public.candidate_requests;
create policy candidate_requests_own on public.candidate_requests for select to authenticated
using (email = (select email from public.profiles where id = (select private.workspace_user_id())) or (select private.is_admin()));

drop policy candidate_requests_insert_own on public.candidate_requests;
create policy candidate_requests_insert_own on public.candidate_requests for insert to authenticated
with check (email = (select email from public.profiles where id = (select private.workspace_user_id())));

drop policy onboarding_storage_read on storage.objects;
create policy onboarding_storage_read on storage.objects for select to authenticated
using (bucket_id = 'candidate-documents' and ((storage.foldername(name))[1] = (select private.workspace_user_id())::text or (select private.is_admin())));

drop policy onboarding_storage_insert on storage.objects;
create policy onboarding_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select private.workspace_user_id())::text);

drop policy onboarding_storage_delete on storage.objects;
create policy onboarding_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select private.workspace_user_id())::text);

drop policy contract_storage_read on storage.objects;
create policy contract_storage_read on storage.objects for select to authenticated
using (bucket_id = 'contracts' and ((storage.foldername(name))[1] = (select private.workspace_user_id())::text or (select private.is_admin())));
