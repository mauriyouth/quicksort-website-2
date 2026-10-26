-- Kanban is additive and uses the portal's existing verified identity bridge.
create or replace function private.kanban_actor() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
begin
  -- Reuse the verified, read-only Clerk identity lookup used by portal RLS.
  -- Legacy Supabase Auth installations use auth.uid().
  if to_regprocedure('private.current_user_id()') is not null then
    return private.current_user_id();
  end if;
  return auth.uid();
end;
$$;
revoke all on function private.kanban_actor() from public, anon;
grant execute on function private.kanban_actor() to authenticated;

-- Private lookup is needed because candidates cannot read other users' roles.
create function private.kanban_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles
    where user_id = (select private.kanban_actor()) and role = 'admin');
$$;
revoke all on function private.kanban_admin() from public, anon;
grant execute on function private.kanban_admin() to authenticated;

create table public.kanban_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.kanban_boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.kanban_projects(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create index kanban_boards_project_idx on public.kanban_boards(project_id);
create table public.kanban_project_members (
  project_id uuid not null references public.kanban_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(project_id, user_id)
);
create index kanban_project_members_user_idx on public.kanban_project_members(user_id);
create table public.kanban_board_members (
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(board_id, user_id)
);
create index kanban_board_members_user_idx on public.kanban_board_members(user_id);
create table public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  position integer not null default 0 check (position >= 0),
  unique(board_id, id)
);
create table public.kanban_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  column_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  created_by uuid not null references public.profiles(id),
  creator_name text not null,
  created_at timestamptz not null default now(),
  foreign key(board_id, column_id) references public.kanban_columns(board_id, id)
);
create index kanban_cards_column_idx on public.kanban_cards(board_id, column_id);
create index kanban_cards_creator_idx on public.kanban_cards(created_by);

alter table public.kanban_projects enable row level security;
alter table public.kanban_boards enable row level security;
alter table public.kanban_project_members enable row level security;
alter table public.kanban_board_members enable row level security;
alter table public.kanban_columns enable row level security;
alter table public.kanban_cards enable row level security;
revoke all on public.kanban_projects, public.kanban_boards, public.kanban_project_members,
  public.kanban_board_members, public.kanban_columns, public.kanban_cards from anon, authenticated;
grant select, insert on public.kanban_projects, public.kanban_boards, public.kanban_columns to authenticated;
grant select, insert, delete on public.kanban_project_members, public.kanban_board_members to authenticated;
grant select on public.kanban_cards to authenticated;
grant insert(board_id, column_id, title, description) on public.kanban_cards to authenticated;
-- Candidates can move cards, but neither candidates nor admins can forge authors,
-- change content, or transfer existing cards to a different board through this API.
grant update(column_id) on public.kanban_cards to authenticated;

create policy project_members_read on public.kanban_project_members for select to authenticated
using (user_id = (select private.kanban_actor()) or (select private.kanban_admin()));
create policy project_members_insert on public.kanban_project_members for insert to authenticated
with check ((select private.kanban_admin()));
create policy project_members_delete on public.kanban_project_members for delete to authenticated
using ((select private.kanban_admin()));
create policy board_members_read on public.kanban_board_members for select to authenticated
using (user_id = (select private.kanban_actor()) or (select private.kanban_admin()));
create policy board_members_insert on public.kanban_board_members for insert to authenticated
with check ((select private.kanban_admin()));
create policy board_members_delete on public.kanban_board_members for delete to authenticated
using ((select private.kanban_admin()));

create policy boards_read on public.kanban_boards for select to authenticated
using ((select private.kanban_admin())
  or exists (select 1 from public.kanban_project_members m where m.project_id = kanban_boards.project_id and m.user_id = (select private.kanban_actor()))
  or exists (select 1 from public.kanban_board_members m where m.board_id = kanban_boards.id and m.user_id = (select private.kanban_actor())));
create policy boards_insert on public.kanban_boards for insert to authenticated with check ((select private.kanban_admin()));
create policy projects_read on public.kanban_projects for select to authenticated
using ((select private.kanban_admin())
  or exists (select 1 from public.kanban_project_members m where m.project_id = kanban_projects.id and m.user_id = (select private.kanban_actor()))
  or exists (select 1 from public.kanban_boards b
    join public.kanban_board_members m on m.board_id = b.id
    where b.project_id = kanban_projects.id and m.user_id = (select private.kanban_actor())));
create policy projects_insert on public.kanban_projects for insert to authenticated with check ((select private.kanban_admin()));
-- Explicit membership check for child resources, in addition to board RLS.
create function private.kanban_can_access_board(target_board uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select (select private.kanban_actor()) is not null and exists (
    select 1 from public.kanban_boards b where b.id = target_board and (
      (select private.kanban_admin())
      or exists (select 1 from public.kanban_project_members m
        where m.project_id = b.project_id and m.user_id = (select private.kanban_actor()))
      or exists (select 1 from public.kanban_board_members m
        where m.board_id = b.id and m.user_id = (select private.kanban_actor()))
    )
  );
$$;
revoke all on function private.kanban_can_access_board(uuid) from public, anon;
grant execute on function private.kanban_can_access_board(uuid) to authenticated;

create policy columns_read on public.kanban_columns for select to authenticated
using (private.kanban_can_access_board(kanban_columns.board_id));
create policy columns_insert on public.kanban_columns for insert to authenticated with check ((select private.kanban_admin()));
create policy cards_read on public.kanban_cards for select to authenticated
using (private.kanban_can_access_board(kanban_cards.board_id));
create policy cards_insert on public.kanban_cards for insert to authenticated
with check (created_by = (select private.kanban_actor()) and private.kanban_can_access_board(kanban_cards.board_id));
create policy cards_move on public.kanban_cards for update to authenticated
using (private.kanban_can_access_board(kanban_cards.board_id))
with check (private.kanban_can_access_board(kanban_cards.board_id));

create function private.kanban_stamp_card() returns trigger
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
revoke all on function private.kanban_stamp_card() from public, anon;
create trigger kanban_stamp_card before insert on public.kanban_cards
for each row execute function private.kanban_stamp_card();

create function private.kanban_default_columns() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.kanban_columns(board_id, name, position) values
    (new.id, 'To do', 0), (new.id, 'In progress', 1),
    (new.id, 'Blocked', 2), (new.id, 'Done', 3);
  return new;
end;
$$;
revoke all on function private.kanban_default_columns() from public, anon;
create trigger kanban_default_columns after insert on public.kanban_boards
for each row execute function private.kanban_default_columns();
