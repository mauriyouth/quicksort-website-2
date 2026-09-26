-- Bootstrap: seed the owner team after the first Clerk sign-in.
-- portal_owners was empty (the jermiah@quicksort.fr seed in
-- 20260923083416_clerk_access_bridge.sql no-ops until that profile exists), so
-- no one could review admin access and every request stayed pending.
-- This mirrors that bootstrap for mohamed@quicksort.fr: admin role plus owner
-- protection, idempotently, and closes the pending access request so the
-- awaiting-approval screen resolves on the next automatic check.
-- No-ops until the account exists; run the same statements after a later first
-- sign-in if the profile is created later.

update public.user_roles set role = 'admin'
where user_id = (select id from public.profiles where lower(email) = 'mohamed@quicksort.fr');

insert into public.portal_owners (user_id)
select id from public.profiles where lower(email) = 'mohamed@quicksort.fr'
on conflict do nothing;

update public.admin_access_requests
set status = 'approved', reviewed_at = now()
where user_id = (select id from public.profiles where lower(email) = 'mohamed@quicksort.fr')
  and status = 'pending';
