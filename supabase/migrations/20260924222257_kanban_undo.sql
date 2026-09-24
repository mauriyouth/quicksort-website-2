-- Keep one committed action per identity and verified portal origin. Payloads are
-- private, server-captured rows; clients can never supply restoration data.
create table private.kanban_undo_actions (
  actor uuid not null references public.profiles(id) on delete cascade,
  origin text not null, token uuid not null default gen_random_uuid() unique,
  transaction_id bigint not null, is_redo boolean not null default false, primary key(actor, origin)
);
create table private.kanban_undo_rows (
  token uuid references private.kanban_undo_actions(token) on delete cascade on update cascade,
  relation text not null, row_key jsonb not null,
  before_row jsonb, after_row jsonb, primary key(token, relation, row_key)
);
create table private.kanban_undo_replay (transaction_id bigint primary key, token uuid not null);
revoke all on private.kanban_undo_actions, private.kanban_undo_rows, private.kanban_undo_replay from public, anon, authenticated;
alter table private.kanban_undo_actions enable row level security;
alter table private.kanban_undo_rows enable row level security;
alter table private.kanban_undo_replay enable row level security;

create function private.kanban_replaying() returns boolean
language sql security definer set search_path = '' as $$
  select exists(select 1 from private.kanban_undo_replay where transaction_id = txid_current());
$$;
revoke all on function private.kanban_replaying() from public, anon;
grant execute on function private.kanban_replaying() to authenticated;

create function private.kanban_record_undo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.kanban_actor();
  portal text := coalesce(auth.jwt()->>'azp', '');
  before_data jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  after_data jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  data jsonb := coalesce(after_data, before_data);
  key_data jsonb;
  action_token uuid;
begin
  key_data := case when data ? 'id' then jsonb_build_object('id', data->'id')
    when data ? 'project_id' then jsonb_build_object('project_id', data->'project_id', 'user_id', data->'user_id')
    else jsonb_build_object('board_id', data->'board_id', 'user_id', data->'user_id') end;
  select token into action_token from private.kanban_undo_replay where transaction_id = txid_current();
  if found then
    -- Reject cascades into rows another person added after the original action.
    if tg_op = 'DELETE' and not exists(select 1 from private.kanban_undo_rows
      where token = action_token and relation = tg_table_name and row_key = key_data and before_row is null) then
      raise exception 'Cannot undo or redo: someone added related work. Refresh your board.';
    end if;
    return null;
  end if;
  if actor_id is null or before_data is not distinct from after_data then return null; end if;
  -- Serialize each user's history; a failed mutation rolls back its history too.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || portal, 0));
  delete from private.kanban_undo_actions where actor = actor_id and origin = portal and transaction_id <> txid_current();
  insert into private.kanban_undo_actions(actor, origin, transaction_id)
    values(actor_id, portal, txid_current()) on conflict(actor, origin) do nothing;
  select token into action_token from private.kanban_undo_actions where actor = actor_id and origin = portal;
  insert into private.kanban_undo_rows(token, relation, row_key, before_row, after_row)
    values(action_token, tg_table_name, key_data, before_data, after_data)
    on conflict(token, relation, row_key) do update set after_row = excluded.after_row;
  return null;
end;
$$;
revoke all on function private.kanban_record_undo() from public, anon, authenticated;
create trigger kanban_undo after insert or update or delete on public.kanban_projects
for each row execute function private.kanban_record_undo();
create trigger kanban_undo after insert or update or delete on public.kanban_boards
for each row execute function private.kanban_record_undo();
create trigger kanban_undo after insert or update or delete on public.kanban_columns
for each row execute function private.kanban_record_undo();
create trigger kanban_undo after insert or update or delete on public.kanban_cards
for each row execute function private.kanban_record_undo();
create trigger kanban_undo after insert or update or delete on public.kanban_project_members
for each row execute function private.kanban_record_undo();
create trigger kanban_undo after insert or update or delete on public.kanban_board_members
for each row execute function private.kanban_record_undo();

create or replace function private.kanban_stamp_card() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if private.kanban_replaying() then return new; end if;
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

create or replace function private.kanban_default_columns() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if private.kanban_replaying() then return new; end if;
  insert into public.kanban_columns(board_id, name, position) values
    (new.id, 'To do', 0), (new.id, 'In progress', 1),
    (new.id, 'Blocked', 2), (new.id, 'Done', 3);
  return new;
end;
$$;

create or replace function private.kanban_stamp_parent() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if private.kanban_replaying() then return new; end if;
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

create function private.kanban_undo_token() returns uuid
language sql security definer set search_path = '' as $$
  select token from private.kanban_undo_actions
  where actor = private.kanban_actor() and origin = coalesce(auth.jwt()->>'azp', '');
$$;
revoke all on function private.kanban_undo_token() from public, anon;
grant execute on function private.kanban_undo_token() to authenticated;
create function public.kanban_undo_token() returns uuid
language sql security invoker set search_path = '' as $$ select private.kanban_undo_token(); $$;
revoke all on function public.kanban_undo_token() from public, anon;
grant execute on function public.kanban_undo_token() to authenticated;

create function private.undo_kanban_action(expected_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.kanban_actor();
  portal text := coalesce(auth.jwt()->>'azp', '');
  entry record;
  current_data jsonb;
  assignments text;
  redo boolean;
  next_token uuid;
begin
  if actor_id is null then raise exception 'Sign in to undo or redo.' using errcode = '42501'; end if;
  -- Lock before reading history so concurrent edits cannot pass conflict checks.
  lock table public.kanban_projects, public.kanban_boards, public.kanban_columns,
    public.kanban_cards, public.kanban_project_members, public.kanban_board_members in share row exclusive mode;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || portal, 0));
  if expected_token is null or not exists(select 1 from private.kanban_undo_actions
    where actor = actor_id and origin = portal and token = expected_token) then
    raise exception 'This action is no longer available to undo or redo.';
  end if;
  select is_redo into redo from private.kanban_undo_actions where token = expected_token;
  for entry in select * from private.kanban_undo_rows where token = expected_token
    and before_row is distinct from after_row loop
    if not private.kanban_admin() then
      if entry.relation <> 'kanban_cards'
        or not private.kanban_can_access_board((coalesce(entry.after_row, entry.before_row)->>'board_id')::uuid)
        or (entry.after_row is null and (not redo or entry.before_row->>'created_by' <> actor_id::text))
        or (entry.before_row is null and entry.after_row->>'created_by' <> actor_id::text)
        or (entry.before_row is not null and entry.after_row is not null and (entry.before_row - 'column_id') <> (entry.after_row - 'column_id')) then
        raise exception 'You no longer have permission to undo or redo this action.' using errcode = '42501';
      end if;
    end if;
    execute format('select to_jsonb(t) from public.%I t where to_jsonb(t) @> $1', entry.relation)
      into current_data using entry.row_key;
    if current_data is distinct from entry.after_row then
      raise exception 'Cannot undo or redo: this item has changed since your action. Refresh your board.';
    end if;
  end loop;
  insert into private.kanban_undo_replay values(txid_current(), expected_token);
  -- Remove created children before parents; restore deleted parents before children.
  for entry in select * from private.kanban_undo_rows where token = expected_token
    and before_row is null and after_row is not null
    order by case relation when 'kanban_projects' then 1 when 'kanban_boards' then 2 when 'kanban_columns' then 3 else 4 end desc loop
    execute format('delete from public.%I t where to_jsonb(t) @> $1', entry.relation) using entry.row_key;
  end loop;
  for entry in select * from private.kanban_undo_rows where token = expected_token
    and before_row is not null and before_row is distinct from after_row
    order by case relation when 'kanban_projects' then 1 when 'kanban_boards' then 2 when 'kanban_columns' then 3 else 4 end loop
    if entry.after_row is null then
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', entry.relation, entry.relation) using entry.before_row;
    else
      select string_agg(format('%I = r.%I', key, key), ', ') into assignments from jsonb_object_keys(entry.before_row) key;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where to_jsonb(t) @> $2', entry.relation, assignments, entry.relation)
        using entry.before_row, entry.row_key;
    end if;
  end loop;
  delete from private.kanban_undo_replay where transaction_id = txid_current();
  -- Keep the inverse operation for redo (or undo again), with a fresh token so
  -- retries and stale tabs can never accidentally apply the opposite operation.
  update private.kanban_undo_rows set before_row = after_row, after_row = before_row where token = expected_token;
  update private.kanban_undo_actions set token = gen_random_uuid(),
    is_redo = not is_redo, transaction_id = txid_current()
    where token = expected_token returning token into next_token;
  return next_token;
end;
$$;
revoke all on function private.undo_kanban_action(uuid) from public, anon;
grant execute on function private.undo_kanban_action(uuid) to authenticated;
create function public.undo_kanban_action(expected_token uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.undo_kanban_action(expected_token); $$;
revoke all on function public.undo_kanban_action(uuid) from public, anon;
grant execute on function public.undo_kanban_action(uuid) to authenticated;
