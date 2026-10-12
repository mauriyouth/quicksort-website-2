# Operations

## 1. Operations board (kanban)

The Operations module is the team's internal work-tracking space, starting with a
custom kanban board (`src/ops/OpsBoard.tsx`).

- **Boards** are custom: anyone can create a board with a name, a description and
  an ordered set of columns (one per line at creation). Boards are listed as
  pills with an initial disc and their card count. A board can be renamed or
  deleted (deleting removes its columns and cards).
- **Columns** belong to a board, are ordered, and can be added after creation
  ("New column" at the end of the board).
- **Cards** belong to a column and carry a title, optional free-form
  **content** written in Markdown (edited with a minimal Markdown field —
  formatting toolbar plus Write/Preview toggle — in the card editor,
  first line shown on the card), an optional priority (`P1`–`P3`, rendered as
  a badge) and an optional owner email. Cards are added with an inline
  title input per column ("Add a card" → type the ticket title, Enter adds it
  and keeps the input open); the new card is owned by the author, who can
  then double-click it to attach content, priority or a different owner.
- **Moving cards** happens by drag-and-drop between columns, or explicitly via
  the "Move to" control in the card editor (same fallback pattern as the sales
  pipeline board, per sales.md §10).
- **Selecting cards**: a click selects a card (lime ring) without opening it;
  **Space** assigns it to me (or unassigns when already mine), **Enter** opens
  the editor, **Escape** deselects. Double-click also opens the editor.
- **Filtering**: a search box narrows the visible cards on the selected board
  by ticket title or owner email.
- **Persistence**: three tables — `ops_boards`, `ops_columns`, `ops_cards`
  (migration `20261005090000_ops_boards.sql`) — with admin-only RLS through
  `private.is_admin()`, the same access model as the sales pipeline.

The reference workflow is deck production: every deck starts in *Specs to
define* with business requirements (audience, problem, key messages, content),
then flows through *Specs approved → In production → In review → Ready*.
