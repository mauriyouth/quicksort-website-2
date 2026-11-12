-- Admin-created accounts (Accounts > Create account, apps/admin/api/accounts.ts).
-- The API creates the Clerk user with public_metadata.user_id = new_id (read by
-- the `supabase` JWT template), then calls this to create the workspace side:
-- shadow auth user, profile, role, and an audit row. Admin rights themselves are
-- still granted only through review_admin_access (owners).
alter table public.admin_access_audit drop constraint admin_access_audit_action_check;
alter table public.admin_access_audit add constraint admin_access_audit_action_check
  check (action in ('approved', 'rejected', 'revoked', 'impersonated', 'created') or action like 'role:%');

create or replace function public.create_workspace_account(new_id uuid, account_email text, account_name text, account_role text)
returns uuid
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := private.workspace_user_id();
  v_email text := lower(trim(coalesce(account_email, '')));
  v_name text := left(trim(coalesce(account_name, '')), 200);
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.is_admin() then raise exception 'Only administrators can create accounts'; end if;
  if account_role not in ('candidate', 'employee', 'hr', 'sales') then
    raise exception 'Choose a candidate, employee, HR or sales role';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'An account already exists for %', v_email;
  end if;

  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (new_id, v_email, now(), jsonb_build_object('full_name', v_name));
  insert into public.profiles (id, email, full_name) values (new_id, v_email, v_name)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.user_roles (user_id, role) values (new_id, account_role)
  on conflict (user_id) do update set role = excluded.role;
  insert into public.admin_access_audit (actor_id, target_id, action) values (v_actor, new_id, 'created');
  return new_id;
end;
$$;

revoke all on function public.create_workspace_account(uuid, text, text, text) from public, anon;
grant execute on function public.create_workspace_account(uuid, text, text, text) to authenticated;
