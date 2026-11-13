-- Operations boards for employees: a board has an owner and can be shared
-- with colleagues by email. Admins keep full access (ops_*_admin policies).
-- An employee (open employment: not 'ended') sees the boards they own plus
-- the boards shared with them, and can work the columns and cards of those.
-- Only the owner (or an admin) renames, deletes or re-shares a board.
-- Existing boards have no owner, so they stay admin-only until shared.

alter table public.ops_boards
  add column owner_id uuid references public.profiles(id) on delete set null
    default private.workspace_user_id();
create index ops_boards_owner_idx on public.ops_boards(owner_id);

create table public.ops_board_shares (
  board_id uuid not null references public.ops_boards(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+$' and length(email) <= 200),
  created_at timestamptz not null default now(),
  primary key (board_id, email)
);
alter table public.ops_board_shares enable row level security;
create index ops_board_shares_email_idx on public.ops_board_shares(email);

-- Signed-in user's lowercase email (profiles is not readable by employees).
create function private.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(p.email) from public.profiles p where p.id = private.workspace_user_id();
$$;

-- Open employment for the signed-in user (preboarding, active, offboarding).
create function private.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.workspace_user_id() is not null and exists (
    select 1 from public.employees e
    join public.hr_person_accounts m on m.person_id = e.person_id
    where m.profile_id = private.workspace_user_id() and e.status <> 'ended'
  );
$$;

-- Security definer so board/share policies can reference each other without
-- RLS recursion. Admin access is granted separately by the admin policies.
create function private.ops_owns_board(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_employee() and exists (
    select 1 from public.ops_boards b
    where b.id = target and b.owner_id = private.workspace_user_id()
  );
$$;

create function private.ops_can_access_board(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_employee() and exists (
    select 1 from public.ops_boards b
    where b.id = target and (
      b.owner_id = private.workspace_user_id()
      or exists (select 1 from public.ops_board_shares s
                 where s.board_id = b.id and s.email = private.my_email())
    )
  );
$$;

create function private.ops_shared_with_me(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_board_shares s
                 where s.board_id = target and s.email = private.my_email());
$$;

-- A card's column must belong to the card's board.
create function private.ops_column_on_board(col uuid, target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ops_columns c where c.id = col and c.board_id = target);
$$;

revoke all on function private.my_email(), private.is_employee(),
  private.ops_owns_board(uuid), private.ops_can_access_board(uuid),
  private.ops_shared_with_me(uuid), private.ops_column_on_board(uuid, uuid) from public, anon;
grant execute on function private.my_email(), private.is_employee(),
  private.ops_owns_board(uuid), private.ops_can_access_board(uuid),
  private.ops_shared_with_me(uuid), private.ops_column_on_board(uuid, uuid) to authenticated;

-- Boards
-- Owner check is inline (not via ops_can_access_board) so INSERT … RETURNING
-- sees the row it just created.
create policy ops_boards_member_read on public.ops_boards for select to authenticated
  using ((select private.is_employee()) and (
    owner_id = (select private.workspace_user_id())
    or (select private.ops_shared_with_me(id))
  ));
create policy ops_boards_employee_insert on public.ops_boards for insert to authenticated
  with check ((select private.is_employee()) and owner_id = (select private.workspace_user_id()));
create policy ops_boards_owner_update on public.ops_boards for update to authenticated
  using ((select private.ops_owns_board(id)))
  with check (owner_id = (select private.workspace_user_id()));
create policy ops_boards_owner_delete on public.ops_boards for delete to authenticated
  using ((select private.ops_owns_board(id)));

-- Columns and cards: anyone with access to the board.
create policy ops_columns_member on public.ops_columns for all to authenticated
  using ((select private.ops_can_access_board(board_id)))
  with check ((select private.ops_can_access_board(board_id)));
create policy ops_cards_member on public.ops_cards for all to authenticated
  using ((select private.ops_can_access_board(board_id)))
  with check ((select private.ops_can_access_board(board_id))
    and (select private.ops_column_on_board(column_id, board_id)));

-- Shares: admins manage all; owners manage their board's; members can see
-- who else is on a board they can open.
create policy ops_board_shares_admin on public.ops_board_shares for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy ops_board_shares_member_read on public.ops_board_shares for select to authenticated
  using ((select private.ops_can_access_board(board_id)));
create policy ops_board_shares_owner_insert on public.ops_board_shares for insert to authenticated
  with check ((select private.ops_owns_board(board_id)));
create policy ops_board_shares_owner_delete on public.ops_board_shares for delete to authenticated
  using ((select private.ops_owns_board(board_id)));

grant select, insert, delete on public.ops_board_shares to authenticated;

-- People a board can be shared with: colleagues with an open employment,
-- plus admins. Callable by admins and employees only.
create function public.ops_share_directory()
returns table (email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct lower(p.email), p.full_name
  from public.profiles p
  where (private.is_admin() or private.is_employee())
    and p.email <> ''
    and (
      exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
      or exists (select 1 from public.hr_person_accounts m
                 join public.employees e on e.person_id = m.person_id
                 where m.profile_id = p.id and e.status <> 'ended')
    )
  order by 1;
$$;
revoke all on function public.ops_share_directory() from public, anon;
grant execute on function public.ops_share_directory() to authenticated;
