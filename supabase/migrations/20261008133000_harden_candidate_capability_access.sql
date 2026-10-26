-- Supabase can grant function execution directly to API roles through default
-- privileges. Remove anonymous execution explicitly and consolidate profile edits.
revoke all on function public.approve_candidate_capability_profile(uuid) from public, anon;
revoke all on function public.get_business_capabilities() from public, anon;
grant execute on function public.approve_candidate_capability_profile(uuid) to authenticated;
grant execute on function public.get_business_capabilities() to authenticated;

drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (id = (select private.current_user_id()) or (select private.is_admin()))
with check (id = (select private.current_user_id()) or (select private.is_admin()));

create index if not exists candidate_profiles_approved_by_idx
on public.candidate_profiles(approved_by) where approved_by is not null;
