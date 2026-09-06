-- Quicksort workforce platform. Promoted into a timestamped migration by the CLI.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 200),
  email text not null,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'candidate' check (role in ('admin', 'candidate'))
);
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Private lookup avoids recursive role policies; roles are never sourced from user metadata.
create function private.is_admin() returns boolean language sql stable security definer
set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated, anon;

create function private.handle_new_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, coalesce(new.email, ''), left(coalesce(new.raw_user_meta_data->>'full_name', ''), 200));
  insert into public.user_roles(user_id, role) values (new.id, 'candidate');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy roles_read on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
grant select on public.profiles, public.user_roles to authenticated;
grant update(full_name) on public.profiles to authenticated;
-- Role changes are performed only by the database owner / trusted administrative service.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) between 1 and 200),
  department text not null default 'Engineering',
  location text not null,
  employment_type text not null default 'Permanent (CDI)',
  description text not null check (length(trim(description)) between 1 and 20000),
  linkedin_url text not null check (linkedin_url ~ '^https://(www\.)?linkedin\.com/[^[:space:]]+$'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.jobs enable row level security;
create index jobs_published_created_idx on public.jobs(created_at desc) where published;
create policy jobs_read on public.jobs for select to anon, authenticated
using (published or (select private.is_admin()));
create policy jobs_insert on public.jobs for insert to authenticated with check ((select private.is_admin()));
create policy jobs_update on public.jobs for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy jobs_delete on public.jobs for delete to authenticated using ((select private.is_admin()));
grant select on public.jobs to anon, authenticated;
grant insert, update, delete on public.jobs to authenticated;

create table public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 255),
  category text not null check (category in ('identity', 'resume', 'qualification', 'other')),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = candidate_id::text)
);
alter table public.candidate_documents enable row level security;
create index candidate_documents_owner_idx on public.candidate_documents(candidate_id);
create policy documents_read on public.candidate_documents for select to authenticated
using (candidate_id = (select auth.uid()) or (select private.is_admin()));
create policy documents_insert on public.candidate_documents for insert to authenticated
with check (candidate_id = (select auth.uid()));
create policy documents_delete on public.candidate_documents for delete to authenticated
using (candidate_id = (select auth.uid()));
grant select, insert, delete on public.candidate_documents to authenticated;

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  storage_path text not null unique,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = candidate_id::text)
);
alter table public.contracts enable row level security;
create index contracts_owner_idx on public.contracts(candidate_id);
create policy contracts_read on public.contracts for select to authenticated
using (candidate_id = (select auth.uid()) or (select private.is_admin()));
create policy contracts_insert on public.contracts for insert to authenticated with check ((select private.is_admin()));
grant select, insert on public.contracts to authenticated;
-- No update/delete: a new contract is a new immutable document, preserving signatures.

create table public.contract_signatures (
  contract_id uuid primary key references public.contracts(id) on delete restrict,
  candidate_id uuid not null references public.profiles(id) on delete restrict,
  signer_name text not null check (length(trim(signer_name)) between 2 and 200),
  consent_text text not null default 'I have read this contract and agree to sign it electronically.',
  document_sha256 text not null,
  signed_at timestamptz not null default now()
);
alter table public.contract_signatures enable row level security;
create index signatures_owner_idx on public.contract_signatures(candidate_id);
create policy signatures_read on public.contract_signatures for select to authenticated
using (candidate_id = (select auth.uid()) or (select private.is_admin()));
create policy signatures_insert on public.contract_signatures for insert to authenticated
with check (candidate_id = (select auth.uid()) and exists (
  select 1 from public.contracts c where c.id = contract_id and c.candidate_id = (select auth.uid())
));
grant select on public.contract_signatures to authenticated;
grant insert(contract_id, signer_name) on public.contract_signatures to authenticated;
create function private.record_signature() returns trigger language plpgsql security invoker
set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select c.document_sha256 into new.document_sha256 from public.contracts c
    where c.id = new.contract_id and c.candidate_id = auth.uid();
  if not found then raise exception 'Contract not available'; end if;
  new.candidate_id := auth.uid();
  new.signed_at := now();
  new.consent_text := 'I have read this contract and agree to sign it electronically.';
  return new;
end;
$$;
revoke all on function private.record_signature() from public;
create trigger stamp_contract_signature before insert on public.contract_signatures
for each row execute function private.record_signature();

create table public.tool_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  tool_name text not null check (length(trim(tool_name)) between 1 and 100),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.tool_requests enable row level security;
create index tool_requests_owner_idx on public.tool_requests(candidate_id);
create index tool_requests_pending_idx on public.tool_requests(created_at) where status = 'pending';
create policy requests_read on public.tool_requests for select to authenticated
using (candidate_id = (select auth.uid()) or (select private.is_admin()));
create policy requests_insert on public.tool_requests for insert to authenticated
with check (candidate_id = (select auth.uid()) and status = 'pending' and admin_note = '');
create policy requests_update on public.tool_requests for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
grant select on public.tool_requests to authenticated;
grant insert(tool_name, reason) on public.tool_requests to authenticated;
grant update(status, admin_note) on public.tool_requests to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
('candidate-documents', 'candidate-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
('contracts', 'contracts', false, 10485760, array['application/pdf']);
create policy onboarding_storage_read on storage.objects for select to authenticated
using (bucket_id = 'candidate-documents' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())));
create policy onboarding_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy onboarding_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy contract_storage_read on storage.objects for select to authenticated
using (bucket_id = 'contracts' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())));
create policy contract_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'contracts' and (select private.is_admin()));
-- No contract object updates or deletes: an existing signed file cannot be replaced.
-- Explicit privileges override Supabase default grants.
revoke all on public.profiles, public.user_roles, public.jobs, public.candidate_documents,
  public.contracts, public.contract_signatures, public.tool_requests from anon, authenticated;
grant select on public.jobs to anon;
grant select on public.profiles, public.user_roles, public.jobs, public.candidate_documents,
  public.contracts, public.contract_signatures, public.tool_requests to authenticated;
grant update(full_name) on public.profiles to authenticated;
grant insert, update, delete on public.jobs to authenticated;
grant insert, delete on public.candidate_documents to authenticated;
grant insert on public.contracts to authenticated;
grant insert(contract_id, signer_name) on public.contract_signatures to authenticated;
grant insert(tool_name, reason) on public.tool_requests to authenticated;
grant update(status, admin_note) on public.tool_requests to authenticated;
create policy contract_storage_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'contracts' and (select private.is_admin()) and not exists (
  select 1 from public.contracts c where c.storage_path = name
));
