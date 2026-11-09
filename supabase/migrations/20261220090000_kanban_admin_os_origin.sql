-- The admin app now serves from https://os.quicksort.fr (Quicksort Operating System).
-- Clerk stamps that origin into the JWT azp claim, so allow it alongside the
-- previous admin origin. Missing/unrecognized origins still fail closed.
create or replace function private.kanban_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'azp') in (
    'https://os.quicksort.fr',
    'https://admin.quicksort.fr',
    'https://quicksort-admin.vercel.app',
    'https://quicksort-admin-mohamed-ahmednahs-projects.vercel.app',
    'http://localhost:5174',
    'http://127.0.0.1:5174'
  ), false)
  and (select private.kanban_actor()) is not null
  and exists (select 1 from public.user_roles
    where user_id = (select private.kanban_actor()) and role = 'admin');
$$;
revoke all on function private.kanban_admin() from public, anon;
grant execute on function private.kanban_admin() to authenticated;
