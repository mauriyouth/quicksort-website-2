-- Details remain visible to board members; only admin-portal admins edit them.
alter table public.kanban_cards add column due_at timestamptz;
grant insert(due_at), update(title, description, due_at) on public.kanban_cards to authenticated;

create function private.kanban_guard_card_details() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.title, new.description, new.due_at) is distinct from
     (old.title, old.description, old.due_at)
     and not (select private.kanban_admin()) then
    raise exception 'Only administrators in the admin portal can edit card details.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.kanban_guard_card_details() from public, anon;
grant execute on function private.kanban_guard_card_details() to authenticated;
create trigger kanban_guard_card_details before update on public.kanban_cards
for each row execute function private.kanban_guard_card_details();
