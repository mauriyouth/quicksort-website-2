-- Card deletion is available only to administrators in the admin portal.
-- No existing cards are changed or deleted by this migration.
grant delete on public.kanban_cards to authenticated;
create policy cards_delete on public.kanban_cards for delete to authenticated
using ((select private.kanban_admin()));
