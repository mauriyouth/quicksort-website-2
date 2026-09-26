# Operations

## 1. Operations board (kanban)

The Operations module is the team's internal work-tracking space, starting with a
custom kanban board (`src/ops/OpsBoard.tsx`).

- **Boards** are custom: anyone can create a board with a name, a description and
  an ordered set of columns (one per line at creation). Boards are listed as tabs
  with their card count. A board can be renamed or deleted (deleting removes its
  columns and cards).
- **Columns** belong to a board, are ordered, and can be added after creation
  ("New column" at the end of the board).
- **Cards** belong to a column and carry a title, an optional priority
  (`P1`–`P3`, rendered as a badge), an optional owner email, and a free-form set
  of **counters** — `{ label, done, total }` pairs such as `✓ 0/6` and
  `Specs 3/6` — rendered as pills. When a card has counters, a progress bar
  shows the aggregate `done / total`. A counter with an empty label renders as ✓.
- **Moving cards** happens by drag-and-drop between columns, or explicitly via
  the "Move to" control in the card editor (same fallback pattern as the sales
  pipeline board, per sales.md §10).
- **Filtering**: an owner filter narrows the visible cards on the selected board.
- **Persistence**: three tables — `ops_boards`, `ops_columns`, `ops_cards`
  (migration `20261005090000_ops_boards.sql`) — with admin-only RLS through
  `private.is_admin()`, the same access model as the sales pipeline.

The reference workflow is deck production: every deck starts in *Specs to
define* with business requirements (audience, problem, key messages, content),
then flows through *Specs approved → In production → In review → Ready*.
