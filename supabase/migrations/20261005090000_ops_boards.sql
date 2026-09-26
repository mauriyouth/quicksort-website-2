-- Operations dashboard: custom kanban boards.
-- Boards own ordered columns; cards live in a column and carry a priority,
-- an owner and a free-form set of counters (checklist progress such as
-- "Specs 3/6") rendered as pills and a progress bar in the admin UI.
-- Same access model as the sales pipeline: admins manage everything through
-- RLS keyed on private.is_admin().

create table public.ops_boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ops_boards enable row level security;
create index ops_boards_position_idx on public.ops_boards(position);

create table public.ops_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.ops_boards(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);
alter table public.ops_columns enable row level security;
create index ops_columns_board_idx on public.ops_columns(board_id, position);

create table public.ops_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.ops_boards(id) on delete cascade,
  column_id uuid not null references public.ops_columns(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  priority text not null default '' check (priority ~ '^P[1-9][0-9]?$' or priority = ''),
  owner_email text not null default '' check (length(owner_email) <= 200),
  counters jsonb not null default '[]' check (jsonb_typeof(counters) = 'array'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ops_cards enable row level security;
create index ops_cards_board_idx on public.ops_cards(board_id, position);
create index ops_cards_column_idx on public.ops_cards(column_id, position);

create policy ops_boards_admin on public.ops_boards for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy ops_columns_admin on public.ops_columns for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy ops_cards_admin on public.ops_cards for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Starter content mirroring the operations board the team runs today.
insert into public.ops_boards (id, name, description, position) values
  ('f8a1c020-0001-7000-8000-000000000001', 'Sales decks',
   'Priority 1. Every deck starts with its business requirements: audience, problem, key messages, content.', 0),
  ('f8a1c020-0001-7000-8000-000000000002', 'Events', '', 1),
  ('f8a1c020-0001-7000-8000-000000000003', 'Marketing and website', '', 2),
  ('f8a1c020-0001-7000-8000-000000000004', 'Internal projects', '', 3);

insert into public.ops_columns (id, board_id, name, position) values
  ('f8a1c020-0002-7000-8000-000000000001', 'f8a1c020-0001-7000-8000-000000000001', 'Specs to define', 0),
  ('f8a1c020-0002-7000-8000-000000000002', 'f8a1c020-0001-7000-8000-000000000001', 'Specs approved', 1),
  ('f8a1c020-0002-7000-8000-000000000003', 'f8a1c020-0001-7000-8000-000000000001', 'In production', 2),
  ('f8a1c020-0002-7000-8000-000000000004', 'f8a1c020-0001-7000-8000-000000000001', 'In review', 3),
  ('f8a1c020-0002-7000-8000-000000000005', 'f8a1c020-0001-7000-8000-000000000001', 'Ready', 4),
  ('f8a1c020-0002-7000-8000-000000000006', 'f8a1c020-0001-7000-8000-000000000002', 'To plan', 0),
  ('f8a1c020-0002-7000-8000-000000000007', 'f8a1c020-0001-7000-8000-000000000002', 'Planned', 1),
  ('f8a1c020-0002-7000-8000-000000000008', 'f8a1c020-0001-7000-8000-000000000002', 'Done', 2),
  ('f8a1c020-0002-7000-8000-000000000009', 'f8a1c020-0001-7000-8000-000000000003', 'Backlog', 0),
  ('f8a1c020-0002-7000-8000-000000000010', 'f8a1c020-0001-7000-8000-000000000003', 'In progress', 1),
  ('f8a1c020-0002-7000-8000-000000000011', 'f8a1c020-0001-7000-8000-000000000003', 'Shipped', 2),
  ('f8a1c020-0002-7000-8000-000000000012', 'f8a1c020-0001-7000-8000-000000000004', 'Ideas', 0),
  ('f8a1c020-0002-7000-8000-000000000013', 'f8a1c020-0001-7000-8000-000000000004', 'In progress', 1),
  ('f8a1c020-0002-7000-8000-000000000014', 'f8a1c020-0001-7000-8000-000000000004', 'Done', 2);

insert into public.ops_cards (board_id, column_id, title, priority, counters, position) values
  ('f8a1c020-0001-7000-8000-000000000001', 'f8a1c020-0002-7000-8000-000000000001', 'Quicksort company overview deck', 'P1',
   '[{"label": "", "done": 0, "total": 6}, {"label": "Specs", "done": 3, "total": 6}]', 0),
  ('f8a1c020-0001-7000-8000-000000000001', 'f8a1c020-0002-7000-8000-000000000001', 'Sales deck: staff augmentation (Régie)', 'P1',
   '[{"label": "", "done": 0, "total": 6}, {"label": "Specs", "done": 2, "total": 6}]', 1),
  ('f8a1c020-0001-7000-8000-000000000001', 'f8a1c020-0002-7000-8000-000000000001', 'Sales deck: fixed-price projects (Forfait)', 'P1',
   '[{"label": "", "done": 0, "total": 6}, {"label": "Specs", "done": 2, "total": 6}]', 2),
  ('f8a1c020-0001-7000-8000-000000000002', 'f8a1c020-0002-7000-8000-000000000007', 'Quicksort booth: Paris AI Summit', '',
   '[{"label": "", "done": 4, "total": 8}]', 0),
  ('f8a1c020-0001-7000-8000-000000000002', 'f8a1c020-0002-7000-8000-000000000006', 'Tech meetup sponsorship Q4', '',
   '[]', 0),
  ('f8a1c020-0001-7000-8000-000000000002', 'f8a1c020-0002-7000-8000-000000000006', 'Webinar: AI delivery playbook', '',
   '[]', 1),
  ('f8a1c020-0001-7000-8000-000000000002', 'f8a1c020-0002-7000-8000-000000000007', 'Open-source breakfast #12', '',
   '[{"label": "", "done": 6, "total": 6}]', 1),
  ('f8a1c020-0001-7000-8000-000000000002', 'f8a1c020-0002-7000-8000-000000000008', 'Recruiting fair: Ecole 42', '',
   '[]', 0),
  ('f8a1c020-0001-7000-8000-000000000003', 'f8a1c020-0002-7000-8000-000000000010', 'Homepage case-study section', 'P2',
   '[{"label": "", "done": 2, "total": 5}]', 0),
  ('f8a1c020-0001-7000-8000-000000000003', 'f8a1c020-0002-7000-8000-000000000010', 'Blog: gen-ai for regulated industries', '',
   '[{"label": "", "done": 1, "total": 4}]', 1),
  ('f8a1c020-0001-7000-8000-000000000003', 'f8a1c020-0002-7000-8000-000000000009', 'Careers page refresh', '',
   '[]', 0),
  ('f8a1c020-0001-7000-8000-000000000004', 'f8a1c020-0002-7000-8000-000000000013', 'Offboarding checklist automation', 'P2',
   '[{"label": "", "done": 1, "total": 5}]', 0),
  ('f8a1c020-0001-7000-8000-000000000004', 'f8a1c020-0002-7000-8000-000000000012', 'Admin dashboard v2', '',
   '[]', 0);
