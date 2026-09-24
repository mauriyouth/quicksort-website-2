-- Renames preserve column IDs and all card references. Saves are atomic and use RLS.
grant update(name) on public.kanban_boards, public.kanban_columns to authenticated;
create policy boards_update on public.kanban_boards for update to authenticated
using ((select private.kanban_admin())) with check ((select private.kanban_admin()));
create policy columns_update on public.kanban_columns for update to authenticated
using ((select private.kanban_admin())) with check ((select private.kanban_admin()));
-- Only empty columns can be removed: the existing card foreign key prevents data loss.
grant delete on public.kanban_columns to authenticated;
create policy columns_delete on public.kanban_columns for delete to authenticated
using ((select private.kanban_admin()));

create function public.save_kanban_board(target_project uuid, board_name text, column_drafts jsonb, target_board uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  saved_board uuid;
  draft jsonb;
  column_key uuid;
  next_position integer;
begin
  if not coalesce(private.kanban_admin(), false) then
    raise exception 'Only admins can edit boards' using errcode = '42501';
  end if;
  if column_drafts is null or jsonb_typeof(column_drafts) <> 'array' then
    raise exception 'Choose at least one column' using errcode = '22023';
  end if;
  if jsonb_array_length(column_drafts) = 0 or exists (
    select 1 from jsonb_array_elements(column_drafts) d
    where jsonb_typeof(d->'name') is distinct from 'string' or length(trim(d->>'name')) not between 1 and 100
  ) then
    raise exception 'Each column needs a name of 1–100 characters' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(column_drafts) d group by lower(trim(d->>'name')) having count(*) > 1) then
    raise exception 'Use a different name for each column' using errcode = '22023';
  end if;
  if target_board is null then
    if exists (select 1 from jsonb_array_elements(column_drafts) d where d->>'id' is not null) then
      raise exception 'New columns cannot have existing IDs' using errcode = '22023';
    end if;
    insert into public.kanban_boards(project_id, name) values(target_project, trim(board_name)) returning id into saved_board;
    -- Replace the legacy trigger defaults within the same transaction.
    delete from public.kanban_columns where board_id = saved_board;
  else
    select id into saved_board from public.kanban_boards where id = target_board and project_id = target_project for update;
    if saved_board is null then raise exception 'Board no longer available' using errcode = '22023'; end if;
    if exists (select 1 from public.kanban_columns c where c.board_id = saved_board and not exists (
      select 1 from jsonb_array_elements(column_drafts) d where (d->>'id')::uuid = c.id
    )) or exists (select 1 from jsonb_array_elements(column_drafts) d where d->>'id' is not null group by d->>'id' having count(*) > 1) then
      raise exception 'Columns changed. Reopen the editor and try again' using errcode = '22023';
    end if;
    update public.kanban_boards set name = trim(board_name) where id = saved_board;
  end if;
  select coalesce(max(position), -1) + 1 into next_position from public.kanban_columns where board_id = saved_board;
  for draft in select value from jsonb_array_elements(column_drafts) loop
    column_key := (draft->>'id')::uuid;
    if column_key is null then
      insert into public.kanban_columns(board_id, name, position) values(saved_board, trim(draft->>'name'), next_position);
      next_position := next_position + 1;
    else
      update public.kanban_columns set name = trim(draft->>'name') where id = column_key and board_id = saved_board;
      if not found then raise exception 'Column no longer available on this board' using errcode = '22023'; end if;
    end if;
  end loop;
  return saved_board;
end;
$$;
revoke all on function public.save_kanban_board(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.save_kanban_board(uuid, text, jsonb, uuid) to authenticated;
