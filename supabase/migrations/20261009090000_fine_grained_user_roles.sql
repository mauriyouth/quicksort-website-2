-- Fine-grained workspace rights. Beyond the original admin/candidate split,
-- staff accounts carry a workspace role: employee, hr, or sales. Assignment
-- stays owner-side; applications only read these roles.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin', 'candidate', 'employee', 'hr', 'sales'));

-- Role transitions are audited alongside access reviews.
alter table public.admin_access_audit drop constraint admin_access_audit_action_check;
alter table public.admin_access_audit add constraint admin_access_audit_action_check
  check (action in ('approved', 'rejected', 'revoked') or action like 'role:%');

-- Owner-only assignment of the fine-grained staff rights. Admin access keeps
-- flowing through review_admin_access; owner accounts are never touched here.
create or replace function public.assign_workspace_role(target_email text, role text) returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := private.workspace_user_id();
  v_target uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.portal_owners where user_id = v_actor) then
    raise exception 'Only workspace owners can assign workspace roles';
  end if;
  if role not in ('employee', 'hr', 'sales', 'candidate') then
    raise exception 'Unknown workspace role: %', role;
  end if;
  select id into v_target from public.profiles
    where lower(email) = lower(trim(target_email)) limit 1;
  if v_target is null then raise exception 'No workspace account for %', target_email; end if;
  if v_target = v_actor then raise exception 'Owners cannot change their own role'; end if;
  if exists (select 1 from public.portal_owners where user_id = v_target) then
    raise exception 'Owner accounts are managed separately';
  end if;
  if exists (select 1 from public.user_roles where user_id = v_target and role = 'admin') then
    raise exception 'Admin accounts are managed through access review';
  end if;

  insert into public.user_roles (user_id, role) values (v_target, role)
  on conflict (user_id) do update set role = excluded.role;

  insert into public.admin_access_audit (actor_id, target_id, action)
  values (v_actor, v_target, 'role:' || role);
end;
$$;
revoke all on function public.assign_workspace_role(text, text) from public;
grant execute on function public.assign_workspace_role(text, text) to authenticated;
