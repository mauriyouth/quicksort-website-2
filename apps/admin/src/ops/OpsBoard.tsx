import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, Eye, Heading2, Italic, Link2, List, PenLine, Plus, Search, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Notice, Empty } from "@quicksort/hr-ui";
import {
  db,
  errorMessage,
  isMissingRelationError,
  type Row,
} from "@quicksort/hr-db";
import "./ops.css";

/**
 * Operations board: custom kanban boards (ops.md §1). Boards own ordered
 * columns; cards carry a title, free-form Markdown content, a priority and an
 * owner. Cards move by drag-and-drop or via the move control in the card
 * editor — same explicit fallback pattern as the sales pipeline board.
 */
type Board = Row<"ops_boards">;
type Column = Row<"ops_columns">;
type Card = Row<"ops_cards">;

type CardDraft = {
  title: string;
  content: string;
  priority: string;
  owner_email: string;
};

type ColumnDraft = { id: string; name: string };

let columnUid = 0;
const newColumnDraft = (name = ""): ColumnDraft => ({
  id: `col-${++columnUid}`,
  name,
});

const PRIORITIES = ["", "P1", "P2", "P3"];


/** Two-letter initials for the owner avatar disc. */
function initials(email: string): string {
  const local = email.split("@")[0] || email;
  const letters = local
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("");
  return (letters || local).slice(0, 2).toUpperCase();
}

/** First letter of a board name for the pill disc. */
function firstInitial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export function OpsBoard({ actorEmail }: { actorEmail: string }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [boardId, setBoardId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notMigrated, setNotMigrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [addingTo, setAddingTo] = useState(""); // column id with the add-card input open
  const [quickTitle, setQuickTitle] = useState(""); // title typed in the inline add-card input
  const quickCancel = useRef(false); // set on Escape so the blur handler doesn't commit
  const [editing, setEditing] = useState<Card | null>(null); // card in the editor
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [renamingBoard, setRenamingBoard] = useState(""); // board id being renamed
  const [renamingColumn, setRenamingColumn] = useState(""); // column id being renamed
  const [selectedId, setSelectedId] = useState(""); // selected card id
  const [dragOver, setDragOver] = useState(""); // column id highlighted during drag

  const loadBoards = useCallback(async () => {
    try {
      const [boardsResult, cardsResult] = await Promise.all([
        db().from("ops_boards").select("*").order("position"),
        db().from("ops_cards").select("board_id"),
      ]);
      if (boardsResult.error) throw boardsResult.error;
      if (cardsResult.error) throw cardsResult.error;
      const list = boardsResult.data || [];
      const tally: Record<string, number> = {};
      for (const card of cardsResult.data || []) {
        tally[card.board_id] = (tally[card.board_id] || 0) + 1;
      }
      setBoards(list);
      setCounts(tally);
      setBoardId((current) =>
        current && list.some((b) => b.id === current) ? current : (list[0]?.id ?? ""),
      );
    } catch (e) {
      if (isMissingRelationError(e)) setNotMigrated(true);
      else setError(errorMessage(e));
    }
  }, []);

  const loadBoard = useCallback(async (id: string) => {
    if (!id) {
      setColumns([]);
      setCards([]);
      return;
    }
    try {
      const [columnsResult, cardsResult] = await Promise.all([
        db().from("ops_columns").select("*").eq("board_id", id).order("position"),
        db().from("ops_cards").select("*").eq("board_id", id).order("position"),
      ]);
      if (columnsResult.error) throw columnsResult.error;
      if (cardsResult.error) throw cardsResult.error;
      setColumns(columnsResult.data || []);
      setCards(cardsResult.data || []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    await loadBoards();
    setLoading(false);
  }, [loadBoards]);

  useEffect(() => {
    document.title = "Operations board · Quicksort Admin";
    void load();
  }, [load]);

  useEffect(() => {
    setSearch("");
    setQuickTitle("");
    setAddingTo("");
    setEditing(null);
    setRenamingBoard("");
    setRenamingColumn("");
    setSelectedId("");
    void loadBoard(boardId);
  }, [boardId, loadBoard]);

  // Keyboard shortcuts for the selected card: Space assigns it to me (or
  // unassigns when already mine), Enter opens the editor, Escape deselects.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (editing || addingTo || creatingBoard || renamingBoard || renamingColumn) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      const card = cards.find((c) => c.id === selectedId);
      if (!card) return;
      if (e.key === " ") {
        e.preventDefault();
        void toggleAssign(card);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setEditing(card);
      } else if (e.key === "Escape") {
        setSelectedId("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, cards, editing, addingTo, creatingBoard, renamingBoard, renamingColumn]);

  async function action(work: () => Promise<void>, success = "Saved.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await loadBoards();
      await loadBoard(boardId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const board = boards.find((b) => b.id === boardId);
  const visibleCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? cards.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.owner_email.toLowerCase().includes(query),
        )
      : cards;
  }, [cards, search]);
  const cardsOf = (columnId: string) =>
    visibleCards
      .filter((c) => c.column_id === columnId)
      .sort((a, b) => a.position - b.position);

  async function createBoard(name: string, description: string, columnNames: string[]) {
    await action(async () => {
      const boardResult = await db()
        .from("ops_boards")
        .insert({
          name,
          description,
          position: boards.length,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (boardResult.error) throw boardResult.error;
      if (columnNames.length) {
        const columnResult = await db().from("ops_columns").insert(
          columnNames.map((columnName, i) => ({
            board_id: boardResult.data.id,
            name: columnName,
            position: i,
          })),
        );
        if (columnResult.error) throw columnResult.error;
      }
      setCreatingBoard(false);
      setBoardId(boardResult.data.id);
    }, `Board “${name}” created.`);
  }

  async function saveColumnName(column: Column, name: string) {
    const trimmed = name.trim();
    setRenamingColumn("");
    if (!trimmed || trimmed === column.name) return;
    await action(async () => {
      const result = await db()
        .from("ops_columns")
        .update({ name: trimmed })
        .eq("id", column.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Column renamed.");
  }

  async function saveBoardName(board: Board, name: string) {
    const trimmed = name.trim();
    setRenamingBoard("");
    if (!trimmed || trimmed === board.name) return;
    await action(async () => {
      const result = await db()
        .from("ops_boards")
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq("id", board.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Board renamed.");
  }

  /** Space on a selected card toggles ownership: yours ⇄ unassigned. */
  async function toggleAssign(card: Card) {
    if (card.owner_email && card.owner_email !== actorEmail) {
      setMessage(`“${card.title}” is assigned to ${card.owner_email} — open it to reassign.`);
      return;
    }
    const next = card.owner_email === actorEmail ? "" : actorEmail;
    await action(async () => {
      const result = await db()
        .from("ops_cards")
        .update({ owner_email: next, updated_at: new Date().toISOString() })
        .eq("id", card.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, next ? `“${card.title}” assigned to you.` : `“${card.title}” unassigned.`);
  }

  /** Quick-add: creates a card from a bare title, owned by the actor. The
   * inline input stays open so the next ticket can be typed right away;
   * content, priority and reassignment happen in the card editor. */
  async function addCard(column: Column, title: string) {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setQuickTitle("");
    await action(async () => {
      const result = await db()
        .from("ops_cards")
        .insert({
          board_id: column.board_id,
          column_id: column.id,
          title: trimmed,
          content: "",
          priority: "",
          owner_email: actorEmail,
          position: cards.filter((c) => c.column_id === column.id).length,
          updated_at: new Date().toISOString(),
        });
      if (result.error) throw result.error;
    }, "Card added.");
  }

  async function saveCard(draft: CardDraft) {
    if (!editing) return;
    const card = editing;
    await action(async () => {
      const result = await db()
        .from("ops_cards")
        .update({
          title: draft.title.trim(),
          content: draft.content.trim(),
          priority: draft.priority,
          owner_email: draft.owner_email.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      setEditing(null);
    }, "Card updated.");
  }

  async function moveCard(card: Card, columnId: string) {
    if (card.column_id === columnId) return;
    await action(async () => {
      const result = await db()
        .from("ops_cards")
        .update({
          column_id: columnId,
          position: cards.filter((c) => c.column_id === columnId).length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, `“${card.title}” moved to ${columns.find((c) => c.id === columnId)?.name || "column"}.`);
  }

  if (notMigrated) {
    return (
      <Empty title="Operations boards are not set up yet">
        Apply the ops boards migration (20261005090000_ops_boards.sql) to this
        Supabase project, then refresh.
      </Empty>
    );
  }

  return (
    <div className="ops">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      <div className="ops-boards" role="tablist" aria-label="Boards">
        {boards.map((b) =>
          renamingBoard === b.id ? (
            <input
              key={b.id}
              className="ops-board-rename"
              defaultValue={b.name}
              maxLength={200}
              aria-label="Board name"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => void saveBoardName(b, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveBoardName(b, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenamingBoard("");
                }
              }}
            />
          ) : (
            <button
              key={b.id}
              role="tab"
              aria-selected={b.id === boardId}
              className={b.id === boardId ? "ops-board active" : "ops-board"}
              title="Click to open · double-click to rename"
              onClick={() => setBoardId(b.id)}
              onDoubleClick={() => setRenamingBoard(b.id)}
            >
              <span className="ops-board-initial" aria-hidden="true">
                {firstInitial(b.name)}
              </span>
              <span className="ops-board-name">{b.name}</span>
              <span className="ops-board-count">{counts[b.id] || 0}</span>
            </button>
          ),
        )}
        <button className="ops-board ops-board-new" onClick={() => setCreatingBoard(true)}>
          <Plus size={14} />
          New board
        </button>
        {board && (
          <div className="ops-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search tickets or filter by owner"
              placeholder="Search title or owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {board && (
        <div className="ops-toolbar">
          <span className="muted small-text">
            {search.trim()
              ? `${visibleCards.length} of ${cards.length} cards`
              : `${visibleCards.length} card${visibleCards.length === 1 ? "" : "s"}`}
          </span>
          <span style={{ flex: 1 }} />
          {selectedId && (
            <span className="muted small-text ops-kbd-hint">
              Space: assign to me · Enter: edit · Esc: deselect
            </span>
          )}
        </div>
      )}

      {board && (
        <div
          className="ops-kanban"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest(".ops-card")) setSelectedId("");
          }}
        >
          {columns.map((column) => (
            <section
              key={column.id}
              className={dragOver === column.id ? "ops-column drop" : "ops-column"}
              aria-label={`${column.name} column`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== column.id) setDragOver(column.id);
              }}
              onDragLeave={() => setDragOver((current) => (current === column.id ? "" : current))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver("");
                const id = e.dataTransfer.getData("text/plain");
                const card = cards.find((c) => c.id === id);
                if (card) void moveCard(card, column.id);
              }}
            >
              <header className="ops-column-head">
                {renamingColumn === column.id ? (
                  <input
                    className="ops-column-rename"
                    defaultValue={column.name}
                    maxLength={200}
                    aria-label="Column name"
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => void saveColumnName(column, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveColumnName(column, e.currentTarget.value);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingColumn("");
                      }
                    }}
                  />
                ) : (
                  <h2
                    title="Double-click to rename"
                    onDoubleClick={() => setRenamingColumn(column.id)}
                  >
                    {column.name}
                  </h2>
                )}
                <span className="ops-column-count">{cardsOf(column.id).length}</span>
              </header>

              {cardsOf(column.id).map((card) => (
                <article
                  key={card.id}
                  className={selectedId === card.id ? "ops-card selected" : "ops-card"}
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`Card ${card.title}`}
                  aria-pressed={selectedId === card.id}
                  title="Click to select · double-click to edit"
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                  onClick={() => setSelectedId(card.id)}
                  onDoubleClick={() => setEditing(card)}
                >
                  <div className="ops-card-title">
                    {card.priority && (
                      <span className={`ops-priority ops-priority--${card.priority.toLowerCase()}`}>
                        {card.priority}
                      </span>
                    )}
                    <h3>{card.title}</h3>
                  </div>
                  {!!card.content.trim() && (
                    <p className="ops-card-content">{card.content.trim().split(/\r?\n/)[0]}</p>
                  )}
                  {card.owner_email && (
                    <p className="ops-card-owner">
                      <span className="ops-owner-avatar" aria-hidden="true">
                        {initials(card.owner_email)}
                      </span>
                      <span>{card.owner_email}</span>
                    </p>
                  )}
                </article>
              ))}

              {!cardsOf(column.id).length && (
                <p className="ops-column-empty">No cards yet</p>
              )}

              {addingTo === column.id ? (
                <div className="ops-quick-add">
                  <input
                    value={quickTitle}
                    maxLength={300}
                    placeholder="Ticket title, Enter to add"
                    aria-label="New card title"
                    autoFocus
                    onChange={(e) => setQuickTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addCard(column, quickTitle);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        quickCancel.current = true;
                        setAddingTo("");
                        setQuickTitle("");
                      }
                    }}
                    onBlur={() => {
                      // Enter commits (busy) then blurs — keep the input open
                      // for the next card; Escape cancels so blur must not commit.
                      if (busy || quickCancel.current) return;
                      if (quickTitle.trim()) void addCard(column, quickTitle);
                      else setAddingTo("");
                    }}
                  />
                </div>
              ) : (
                <button
                  className="ops-add"
                  onClick={() => {
                    quickCancel.current = false;
                    setQuickTitle("");
                    setAddingTo(column.id);
                  }}
                >
                  <Plus size={14} />
                  Add a card
                </button>
              )}
            </section>
          ))}

          <NewColumn
            board={board}
            columnCount={columns.length}
            disabled={busy}
            onCreate={(name) =>
              action(async () => {
                const result = await db()
                  .from("ops_columns")
                  .insert({ board_id: board.id, name, position: columns.length });
                if (result.error) throw result.error;
              }, `Column “${name}” added.`)
            }
          />
        </div>
      )}

      {creatingBoard && (
        <BoardCreator
          busy={busy}
          onClose={() => setCreatingBoard(false)}
          onCreate={(name, description, columnNames) =>
            createBoard(name, description, columnNames)
          }
        />
      )}

      {editing && (
        <CardEditor
          card={editing}
          columns={columns}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(draft) => void saveCard(draft)}
          onMove={(columnId) => void moveCard(editing, columnId)}
          onDelete={() => {
            const card = editing;
            if (!confirm(`Delete “${card.title}”?`)) return;
            void action(async () => {
              const result = await db().from("ops_cards").delete().eq("id", card.id);
              if (result.error) throw result.error;
              setEditing(null);
            }, "Card deleted.");
          }}
        />
      )}
    </div>
  );
}

/**
 * Create-a-board modal (design: Quicksort brand "Create Board"). Wide
 * dark card over a dimmed board: board name, optional description, a
 * drag-to-reorder column list (Enter adds a row, paste adds many,
 * Backspace on an empty row removes it, Alt+arrows reorder) and a live
 * preview strip. The footer carries a contextual hint, Cancel and a
 * lime submit that stays disabled until the draft is valid.
 */
function BoardCreator({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, columnNames: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Start empty: the user adds column names manually (Enter / "Add column"
  // appends a row; paste bulk-adds many).
  const [columns, setColumns] = useState<ColumnDraft[]>(() => [newColumnDraft()]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const validColumns = columns.map((c) => c.name.trim()).filter(Boolean);
  const canCreate = !!name.trim() && validColumns.length > 0;
  const footerHint = !name.trim()
    ? "Name your board to continue"
    : !validColumns.length
      ? "Add at least one column"
      : `${validColumns.length} column${validColumns.length > 1 ? "s" : ""} · ⌘↵ to create`;

  useEffect(() => {
    const timer = setTimeout(() => document.getElementById("ops-cb-name")?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!focusId) return;
    (
      document.querySelector(`[data-col-input="${focusId}"]`) as HTMLInputElement | null
    )?.focus();
    setFocusId(null);
  }, [focusId]);

  function update(next: ColumnDraft[], focus?: string) {
    setColumns(next);
    if (focus) setFocusId(focus);
  }

  function insertAfter(index: number, names: string[]) {
    const next = [...columns];
    const added = names.map((n) => newColumnDraft(n));
    next.splice(index + 1, 0, ...added);
    update(next, added[added.length - 1]?.id);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    update(next, next[target].id);
  }

  function removeAt(index: number) {
    const next = columns.filter((_, i) => i !== index);
    update(next.length ? next : [newColumnDraft()], next[Math.max(0, index - 1)]?.id);
  }

  async function submit() {
    if (!canCreate || busy) return;
    await onCreate(name.trim(), description.trim(), validColumns.slice(0, 20));
  }

  return (
    <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Create a board">
      <div className="ops-modal-veil" onClick={onClose} />
      <form
        className="ops-creator"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="ops-creator-head">
          <div>
            <h2 id="ops-cb-title">Create a board</h2>
            <p>Cards move left to right through the columns you set here.</p>
          </div>
          <button type="button" className="ops-creator-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="ops-creator-body">
          <label className="ops-creator-field">
            <span>Board name</span>
            <input
              id="ops-cb-name"
              value={name}
              maxLength={200}
              placeholder="e.g. Sales decks"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />
          </label>

          <label className="ops-creator-field">
            <span className="ops-creator-field-label">
              Description <em>Optional</em>
            </span>
            <textarea
              value={description}
              rows={2}
              maxLength={2000}
              placeholder="What this board tracks and how cards flow through it."
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="ops-creator-cols">
            <div className="ops-creator-cols-head">
              <span>Columns</span>
              <span className="ops-creator-cols-hint">Enter adds a column · drag to reorder</span>
            </div>
            <div className="ops-col-list">
              {columns.map((column, i) => (
                <div
                  key={column.id}
                  className="ops-col-row"
                  draggable
                  style={{
                    opacity: dragIndex === i ? 0.4 : 1,
                    background:
                      overIndex === i && dragIndex !== null && dragIndex !== i
                        ? "var(--qs-bg-1)"
                        : undefined,
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragIndex(i);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (overIndex !== i) setOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null || dragIndex === i) return;
                    const next = [...columns];
                    const [moved] = next.splice(dragIndex, 1);
                    next.splice(i, 0, moved);
                    setColumns(next);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <span className="ops-col-grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="ops-col-num">{String(i + 1).padStart(2, "0")}</span>
                  <input
                    data-col-input={column.id}
                    value={column.name}
                    maxLength={200}
                    placeholder="Column name"
                    aria-label={`Column ${i + 1} name`}
                    onChange={(e) =>
                      update(columns.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)))
                    }
                    onDoubleClick={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        insertAfter(i, [""]);
                      } else if (e.key === "Backspace" && !column.name && columns.length > 1) {
                        e.preventDefault();
                        removeAt(i);
                      } else if (e.altKey && e.key === "ArrowUp") {
                        e.preventDefault();
                        move(i, -1);
                      } else if (e.altKey && e.key === "ArrowDown") {
                        e.preventDefault();
                        move(i, 1);
                      } else if (e.key === "ArrowUp" && i > 0) {
                        e.preventDefault();
                        setFocusId(columns[i - 1].id);
                      } else if (e.key === "ArrowDown" && i < columns.length - 1) {
                        e.preventDefault();
                        setFocusId(columns[i + 1].id);
                      }
                    }}
                    onPaste={(e) => {
                      const lines = e.clipboardData
                        .getData("text")
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      if (lines.length < 2) return;
                      e.preventDefault();
                      if (!column.name) {
                        const next = columns.map((c, j) => (j === i ? { ...c, name: lines[0] } : c));
                        setColumns(next);
                        insertAfter(i, lines.slice(1));
                      } else {
                        insertAfter(i, lines);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="ops-col-remove"
                    aria-label={`Remove column ${i + 1}`}
                    onClick={() => removeAt(i)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ops-col-add"
                onClick={() => insertAfter(columns.length - 1, [""])}
              >
                <Plus size={16} />
                Add column
              </button>
            </div>
          </div>

          <div className="ops-creator-preview">
            <span className="ops-creator-preview-label">Preview</span>
            <div className="ops-preview-strip">
              {validColumns.map((columnName, i) => (
                <div key={i} className="ops-preview-col">
                  <span className="ops-preview-name">{columnName}</span>
                  <span className="ops-preview-card" />
                  <span className="ops-preview-card" style={{ opacity: i % 2 ? 0 : 1 }} />
                </div>
              ))}
              {!validColumns.length && (
                <span className="ops-preview-empty">
                  Add a column to see the board take shape.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="ops-creator-foot">
          <span className="ops-creator-hint">{footerHint}</span>
          <div className="actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={busy || !canCreate}>
              Create board
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function NewColumn({
  board,
  columnCount,
  disabled,
  onCreate,
}: {
  board: Board;
  columnCount: number;
  disabled: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="ops-column ops-column-new" onClick={() => setOpen(true)}>
        <Plus size={14} />
        New column
      </button>
    );
  return (
    <form
      className="ops-column ops-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name")).trim();
        if (!name) return;
        void onCreate(name).then(() => setOpen(false));
      }}
    >
      <input name="name" placeholder={`Column ${columnCount + 1}`} required maxLength={200} autoFocus />
      <div className="actions">
        <button className="btn small" disabled={disabled}>
          Add column
        </button>
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <span className="muted small-text">Board: {board.name}</span>
    </form>
  );
}

/**
 * Minimal Markdown field: a textarea with a small formatting toolbar
 * (heading, bold, italic, list, link) and a Write/Preview toggle that
 * renders the value with react-markdown (GFM).
 */
function MarkdownField({
  label,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  label: ReactNode;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  /** Apply a wrap/insert around the current selection, keeping it selected. */
  function apply(before: string, after = before, placeholderText = "text") {
    const el = ref.current;
    if (!el) {
      onChange(value + before + placeholderText + after);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function applyList() {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + "- " + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 2, start + 2);
    });
  }

  const tools = [
    { icon: Heading2, label: "Heading", run: () => apply("## ", "", "Heading") },
    { icon: Bold, label: "Bold", run: () => apply("**") },
    { icon: Italic, label: "Italic", run: () => apply("*") },
    { icon: List, label: "Bullet list", run: applyList },
    {
      icon: Link2,
      label: "Link",
      run: () => apply("[", "](https://)", "link text"),
    },
  ];

  return (
    <div className="ops-md form-field">
      <div className="ops-md-bar">
        <span className="ops-md-label">{label}</span>
        <span style={{ flex: 1 }} />
        {tools.map(({ icon: Icon, label: toolLabel, run }) => (
          <button
            key={toolLabel}
            type="button"
            className="icon-button"
            aria-label={toolLabel}
            title={toolLabel}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} /* keep textarea focus */
            onClick={run}
          >
            <Icon size={14} />
          </button>
        ))}
        <button
          type="button"
          className="btn secondary small"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? <PenLine size={13} /> : <Eye size={13} />}
          {preview ? "Write" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="ops-md-preview">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <span className="muted">Nothing to preview yet.</span>
          )}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          rows={5}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function CardEditor({
  card,
  columns,
  busy,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  card: Card;
  columns: Column[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: CardDraft) => void;
  onMove: (columnId: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<CardDraft>({
    title: card.title,
    content: card.content,
    priority: card.priority,
    owner_email: card.owner_email,
  });
  return (
    <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Edit card">
      <div className="ops-modal-card form">
        <div className="ops-modal-head">
          <h2>Edit card</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label>
          Title
          <input
            value={draft.title}
            maxLength={300}
            autoFocus
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <MarkdownField
          label={<>
            Content <em className="muted">Optional · Markdown</em>
          </>}
          value={draft.content}
          maxLength={20000}
          placeholder="Specs, notes, links — the body of the card."
          onChange={(content) => setDraft({ ...draft, content })}
        />
        <div className="form-columns">
          <label>
            Priority
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p || "None"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <input
              value={draft.owner_email}
              maxLength={200}
              placeholder="name@quicksort.fr"
              onChange={(e) => setDraft({ ...draft, owner_email: e.target.value })}
            />
          </label>
        </div>
        <label>
          Move to
          <select value={card.column_id} onChange={(e) => onMove(e.target.value)}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="btn" disabled={busy || !draft.title.trim()} onClick={() => onSave(draft)}>
            Save card
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
