-- One name per person: the HR record (hr_people.full_name) is the source of
-- truth, and a portal account linked to it carries that name.
-- * Linking an account, or HR renaming the person, copies the name onto the
--   profile. An unlinked account (a candidate who signed up) keeps the name
--   they gave and can still edit it.
-- * A linked profile cannot drift: any other write to its full_name (the
--   portal's Account tab, sync_clerk_profile) is put back to the HR name.
-- * create_workspace_account no longer takes a name, and can create the
--   account straight from an HR person: email and name come from the record
--   and the account is linked in the same transaction. HR may do that for
--   candidate and employee accounts; any other account stays admin-only.

create function private.person_name_for_profile(profile uuid) returns text
language sql stable security definer set search_path = '' as $$
  select h.full_name from public.hr_person_accounts m join public.hr_people h on h.id = m.person_id where m.profile_id = profile
$$;
revoke all on function private.person_name_for_profile(uuid) from public;

create function private.profile_name_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare person_name text := private.person_name_for_profile(new.id);
begin
  if person_name is not null then new.full_name := person_name; end if;
  return new;
end; $$;
revoke all on function private.profile_name_guard() from public;
create trigger profile_name_from_person before insert or update of full_name on public.profiles
  for each row execute function private.profile_name_guard();

create function private.person_account_name_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set full_name = h.full_name
    from public.hr_people h where h.id = new.person_id and p.id = new.profile_id and p.full_name is distinct from h.full_name;
  return new;
end; $$;
revoke all on function private.person_account_name_trigger() from public;
create trigger person_account_name after insert or update of person_id on public.hr_person_accounts
  for each row execute function private.person_account_name_trigger();

create function private.person_rename_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set full_name = new.full_name
    from public.hr_person_accounts m where m.person_id = new.id and p.id = m.profile_id and p.full_name is distinct from new.full_name;
  return new;
end; $$;
revoke all on function private.person_rename_trigger() from public;
create trigger person_rename_profile after update of full_name on public.hr_people
  for each row when (old.full_name is distinct from new.full_name) execute function private.person_rename_trigger();

-- Existing links take the HR name now.
update public.profiles p set full_name = h.full_name
  from public.hr_person_accounts m join public.hr_people h on h.id = m.person_id
 where p.id = m.profile_id and p.full_name is distinct from h.full_name;

-- Portal Account tab: is my name managed by HR?
create function public.my_name_from_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_person_accounts where profile_id = private.workspace_user_id())
$$;
revoke all on function public.my_name_from_hr() from public, anon;
grant execute on function public.my_name_from_hr() to authenticated;

drop function public.create_workspace_account(uuid, text, text, text);
create function public.create_workspace_account(new_id uuid, account_email text, account_role text, link_person uuid default null)
returns uuid
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := private.workspace_user_id();
  v_email text := lower(trim(coalesce(account_email, '')));
  v_person public.hr_people;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if account_role not in ('candidate', 'employee', 'hr', 'sales') then
    raise exception 'Choose a candidate, employee, HR or sales role';
  end if;
  if not private.is_admin()
     and not (link_person is not null and private.hr_operator() and account_role in ('candidate', 'employee')) then
    raise exception 'Only administrators can create accounts';
  end if;
  if link_person is not null then
    select * into v_person from public.hr_people where id = link_person for update;
    if not found then raise exception 'Person not found'; end if;
    if exists (select 1 from public.hr_person_accounts where person_id = link_person) then
      raise exception '% already has a portal account', v_person.full_name;
    end if;
    v_email := lower(trim(coalesce(v_person.email, '')));
    if v_email = '' then raise exception 'Add an email address to % first', v_person.full_name; end if;
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'An account already exists for %', v_email;
  end if;

  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (new_id, v_email, now(), jsonb_build_object('full_name', coalesce(v_person.full_name, '')));
  insert into public.profiles (id, email, full_name) values (new_id, v_email, coalesce(v_person.full_name, ''))
  on conflict (id) do update set email = excluded.email;
  insert into public.user_roles (user_id, role) values (new_id, account_role)
  on conflict (user_id) do update set role = excluded.role;
  if link_person is not null then
    insert into public.hr_person_accounts (profile_id, person_id, linked_by) values (new_id, link_person, v_actor);
  end if;
  insert into public.admin_access_audit (actor_id, target_id, action) values (v_actor, new_id, 'created');
  return new_id;
end;
$$;
revoke all on function public.create_workspace_account(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_workspace_account(uuid, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
