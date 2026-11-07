-- Admin impersonation: an admin can open the portal as another user (Clerk actor
-- token, minted by apps/admin/api/impersonate.ts). This function is the
-- authorization gate and the audit trail; the API only mints a token after it
-- succeeds. Rules: admins only, never yourself, never a portal owner, and only
-- owners may impersonate another admin.
alter table public.admin_access_audit drop constraint admin_access_audit_action_check;
alter table public.admin_access_audit add constraint admin_access_audit_action_check
  check (action in ('approved', 'rejected', 'revoked', 'impersonated') or action like 'role:%');

create or replace function public.begin_impersonation(target_id uuid) returns text
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := private.workspace_user_id();
  v_email text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.is_admin() then raise exception 'Only administrators can impersonate users'; end if;
  if target_id = v_actor then raise exception 'You are already signed in as this user'; end if;
  select email into v_email from public.profiles where id = target_id;
  if v_email is null or v_email = '' then raise exception 'User not found'; end if;
  if exists (select 1 from public.portal_owners where user_id = target_id) then
    raise exception 'Portal owners cannot be impersonated';
  end if;
  if exists (select 1 from public.user_roles where user_id = target_id and role = 'admin')
     and not exists (select 1 from public.portal_owners where user_id = v_actor) then
    raise exception 'Only portal owners can impersonate another administrator';
  end if;
  insert into public.admin_access_audit (actor_id, target_id, action)
  values (v_actor, target_id, 'impersonated');
  return v_email;
end;
$$;

revoke all on function public.begin_impersonation(uuid) from public, anon;
grant execute on function public.begin_impersonation(uuid) to authenticated;
