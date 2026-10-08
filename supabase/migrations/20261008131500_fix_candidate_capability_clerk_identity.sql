-- The production portals authenticate with Clerk. Resolve ownership through the
-- existing verified Clerk-to-profile bridge rather than interpreting Clerk subjects as UUIDs.
alter table public.candidate_skills alter column candidate_id set default private.current_user_id();
alter table public.candidate_projects alter column candidate_id set default private.current_user_id();

drop policy if exists candidate_profiles_read on public.candidate_profiles;
drop policy if exists candidate_profiles_insert on public.candidate_profiles;
drop policy if exists candidate_profiles_update on public.candidate_profiles;
drop policy if exists candidate_skills_read on public.candidate_skills;
drop policy if exists candidate_skills_insert on public.candidate_skills;
drop policy if exists candidate_skills_update on public.candidate_skills;
drop policy if exists candidate_skills_delete on public.candidate_skills;
drop policy if exists candidate_projects_read on public.candidate_projects;
drop policy if exists candidate_projects_insert on public.candidate_projects;
drop policy if exists candidate_projects_update on public.candidate_projects;
drop policy if exists candidate_projects_delete on public.candidate_projects;

create policy candidate_profiles_read on public.candidate_profiles for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_profiles_insert on public.candidate_profiles for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_profiles_update on public.candidate_profiles for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

create policy candidate_skills_read on public.candidate_skills for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_insert on public.candidate_skills for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_update on public.candidate_skills for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_delete on public.candidate_skills for delete to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

create policy candidate_projects_read on public.candidate_projects for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_insert on public.candidate_projects for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_update on public.candidate_projects for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_delete on public.candidate_projects for delete to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

create or replace function public.approve_candidate_capability_profile(target_candidate uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  insert into public.candidate_profiles(candidate_id, review_status, approved_at, approved_by)
  values (target_candidate, 'approved', now(), private.current_user_id())
  on conflict (candidate_id) do update set
    review_status = 'approved', approved_at = now(), approved_by = private.current_user_id(), updated_at = now();
  update public.candidate_skills set approved = true, updated_at = now() where candidate_id = target_candidate;
  update public.candidate_projects set approved = true, updated_at = now() where candidate_id = target_candidate;
end;
$$;
