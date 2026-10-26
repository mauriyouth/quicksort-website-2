-- A global admin role only confers Kanban administration in the admin portal.
-- azp is part of the verified Clerk JWT, not a caller-supplied request header.
-- Missing/unrecognized origins fail closed to ordinary explicit membership.
create or replace function private.kanban_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'azp') in (
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

-- Leave historical authors unknown unless confirmed; never infer them from the
-- current viewer, a card author, or a project member. New rows are always stamped.
alter table public.kanban_projects
  add column created_by uuid references public.profiles(id),
  add column creator_name text;
alter table public.kanban_boards
  add column created_by uuid references public.profiles(id),
  add column creator_name text;
create index kanban_projects_creator_idx on public.kanban_projects(created_by);
create index kanban_boards_creator_idx on public.kanban_boards(created_by);

create function private.kanban_stamp_parent() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.created_by := private.kanban_actor();
  select coalesce(nullif(trim(full_name), ''), email) into new.creator_name
    from public.profiles where id = new.created_by;
  if new.created_by is null or new.creator_name is null then
    raise exception 'A signed-in workspace profile is required' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.kanban_stamp_parent() from public, anon;
create trigger kanban_stamp_project before insert on public.kanban_projects
for each row execute function private.kanban_stamp_parent();
create trigger kanban_stamp_board before insert on public.kanban_boards
for each row execute function private.kanban_stamp_parent();
-- Keep attribution server-owned, including attempts to supply it on insert.
revoke insert on public.kanban_projects, public.kanban_boards from authenticated;
grant insert(name) on public.kanban_projects to authenticated;
grant insert(project_id, name) on public.kanban_boards to authenticated;

-- User-confirmed recovery for the two boards reported in this incident. Restrict
-- by the original names and creation timestamps, so similarly named boards and
-- all other historical rows are untouched. This does not create access grants.
update public.kanban_boards b
set created_by = p.id, creator_name = coalesce(nullif(trim(p.full_name), ''), p.email)
from public.profiles p
where lower(p.email) = 'jermiah@quicksort.fr' and b.created_by is null
  and ((b.name = 'Multimodal AI in production' and b.created_at = timestamptz '2026-09-24 21:27:53.219609+00')
    or (b.name = 'Cerebras' and b.created_at = timestamptz '2026-09-24 21:28:30.564323+00'));
