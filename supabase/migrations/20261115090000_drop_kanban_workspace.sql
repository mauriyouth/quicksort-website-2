-- Remove the kanban workspace: tables, indexes, triggers and functions
-- created by the 20260924* kanban migrations and the business link tables
-- from 20261009061408. The admin/candidate kanban screens are gone, and the
-- business workspace that read these tables is being retired.

-- Link tables (no dependents beyond indexes/policies).
drop table if exists public.kanban_card_contacts cascade;
drop table if exists public.kanban_board_accounts cascade;

-- Core workspace tables (cascade drops indexes and trigger attachments).
drop table if exists public.kanban_cards cascade;
drop table if exists public.kanban_columns cascade;
drop table if exists public.kanban_board_members cascade;
drop table if exists public.kanban_boards cascade;
drop table if exists public.kanban_project_members cascade;
drop table if exists public.kanban_projects cascade;

-- Undo journal (private schema).
drop table if exists private.kanban_undo_replay cascade;
drop table if exists private.kanban_undo_rows cascade;
drop table if exists private.kanban_undo_actions cascade;

-- Public API and undo replay.
drop function if exists public.save_kanban_board(uuid, text, jsonb, uuid);
drop function if exists public.undo_kanban_action(uuid);
drop function if exists private.undo_kanban_action(uuid);
drop function if exists public.kanban_undo_token();

-- Private helpers (order matters little; all depend only on auth/staff).
drop function if exists private.kanban_actor();
drop function if exists private.kanban_admin();
drop function if exists private.kanban_can_access_board(uuid);
drop function if exists private.kanban_record_undo();
drop function if exists private.kanban_stamp_card();
drop function if exists private.kanban_stamp_parent();
drop function if exists private.kanban_default_columns();
drop function if exists private.kanban_guard_card_details();
drop function if exists private.kanban_replaying();
drop function if exists private.kanban_undo_token();
