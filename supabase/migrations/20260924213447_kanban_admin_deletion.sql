-- Parent deletions cascade atomically to boards, columns, cards, and grants.
-- Candidates retain read/create/move permissions without deletion access.
grant delete on public.kanban_projects, public.kanban_boards to authenticated;
create policy projects_delete on public.kanban_projects for delete to authenticated
using ((select private.kanban_admin()));
create policy boards_delete on public.kanban_boards for delete to authenticated
using ((select private.kanban_admin()));
