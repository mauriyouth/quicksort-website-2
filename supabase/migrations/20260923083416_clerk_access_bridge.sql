-- Clerk identity bridge and owner-controlled admin access.
-- Recovered from the live project schema (see packages/hr-db/src/database.types.ts);
-- these objects previously existed only in the SQL editor and were never versioned.

-- Owners are protected administrators; rows are managed by the database owner only.
create table public.portal_owners (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Signed-in users request admin access from the pending screen; owners decide
-- through review_admin_access. Status drives the pending-screen copy.
create table public.admin_access_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);

create table public.admin_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('approved', 'rejected', 'revoked')),
  created_at timestamptz not null default now()
);

alter table public.portal_owners enable row level security;
alter table public.admin_access_requests enable row level security;
alter table public.admin_access_audit enable row level security;

create policy owners_read on public.portal_owners for select to authenticated
using (true);
create policy access_requests_read on public.admin_access_requests for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy access_requests_insert on public.admin_access_requests for insert to authenticated
with check (user_id = (select auth.uid()) and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy access_audit_read on public.admin_access_audit for select to authenticated
using ((select private.is_admin()));

-- Clerk -> Supabase identity bridge, called by every portal on sign-in
-- (packages/hr-db/src/auth.tsx, apps/admin/api/*). The Clerk JWT template must
-- issue the workspace user id (uuid) as the `sub` claim and the account email as
-- `email`; RLS everywhere keys off auth.uid() = sub.
create or replace function public.sync_clerk_profile() returns text
language plpgsql security definer
set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_id uuid;
  v_email text;
  v_name text;
begin
  if claims is null or claims ->> 'sub' is null then
    raise exception 'Clerk identity is missing from this session';
  end if;
  begin
    v_id := (claims ->> 'sub')::uuid;
  exception when invalid_text_representation then
    raise exception 'The Clerk token must carry the workspace user id (uuid) as sub';
  end;
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
revoke all on function public.sync_clerk_profile() from public;
grant execute on function public.sync_clerk_profile() to authenticated;

-- Owner-only access review: approve, reject or revoke admin access by account
-- email; records the request outcome and an audit row atomically.
create or replace function public.review_admin_access(target_email text, decision text) returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
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
revoke all on function public.review_admin_access(text, text) from public;
grant execute on function public.review_admin_access(text, text) to authenticated;

-- Explicit privileges, matching the workforce platform migration style.
revoke all on public.portal_owners, public.admin_access_requests, public.admin_access_audit
  from anon, authenticated;
grant select on public.portal_owners, public.admin_access_audit to authenticated;
grant select, insert on public.admin_access_requests to authenticated;

-- Bootstrap: recover the first administrator and owner grants by verified email
-- (originally 20260906182619_grant_initial_admin.sql + a portal_owners seed).
-- No-ops until the account exists; run the same statements after the first
-- Clerk sign-in if the profile is created later.
update public.user_roles set role = 'admin'
where user_id = (select id from public.profiles where lower(email) = 'jermiah@quicksort.fr');

insert into public.portal_owners (user_id)
select id from public.profiles where lower(email) = 'jermiah@quicksort.fr'
on conflict do nothing;
