import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
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
 * columns; cards carry a priority, an owner and free-form counters
 * (e.g. "Specs 3/6") rendered as pills plus a progress bar. Cards move by
 * drag-and-drop or via the move control in the card editor — same explicit
 * fallback pattern as the sales pipeline board.
 */
type Board = Row<"ops_boards">;
type Column = Row<"ops_columns">;
type Card = Row<"ops_cards">;
type Counter = { label: string; done: number; total: number };

type CardDraft = {
  title: string;
  priority: string;
  owner_email: string;
  counters: Counter[];
};

const DEFAULT_COLUMNS = [
  "Specs to define",
  "Specs approved",
  "In production",
  "In review",
  "Ready",
];
const PRIORITIES = ["", "P1", "P2", "P3"];

function asCounters(value: unknown): Counter[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (c): c is Counter =>
        !!c &&
        typeof c === "object" &&
        typeof (c as Counter).total === "number" &&
        (c as Counter).total > 0,
    )
    .map((c) => ({
      label: typeof c.label === "string" ? c.label : "",
      done: Math.min(Math.max(0, Math.round(c.done || 0)), c.total),
      total: Math.round(c.total),
    }));
}
function progress(counters: Counter[]): number | null {
  const total = counters.reduce((n, c) => n + c.total, 0);
  if (!total) return null;
  const done = counters.reduce((n, c) => n + c.done, 0);
  return Math.round((done / total) * 100);
}

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

export function OpsBoard({ actorEmail }: { actorEmail: string }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [boardId, setBoardId] = useState("");
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(true);
  const [notMigrated, setNotMigrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [addingTo, setAddingTo] = useState(""); // column id with the add-card form open
  const [editing, setEditing] = useState<Card | null>(null); // card in the editor
  const [creatingBoard, setCreatingBoard] = useState(false);
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
    setOwner("");
    setAddingTo("");
    setEditing(null);
    void loadBoard(boardId);
  }, [boardId, loadBoard]);

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
  const owners = useMemo(
    () =>
      [...new Set(cards.map((c) => c.owner_email).filter(Boolean))].sort(),
    [cards],
  );
  const visibleCards = useMemo(
    () => (owner ? cards.filter((c) => c.owner_email === owner) : cards),
    [cards, owner],
  );
  const cardsOf = (columnId: string) =>
    visibleCards
      .filter((c) => c.column_id === columnId)
      .sort((a, b) => a.position - b.position);

  async function createBoard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    const columnNames = String(f.get("columns"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);
    await action(async () => {
      const boardResult = await db()
        .from("ops_boards")
        .insert({
          name,
          description: String(f.get("description")).trim(),
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

  async function addCard(e: FormEvent<HTMLFormElement>, column: Column) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const title = String(f.get("title")).trim();
    if (!title) return;
    await action(async () => {
      const result = await db()
        .from("ops_cards")
        .insert({
          board_id: column.board_id,
          column_id: column.id,
          title,
          owner_email: String(f.get("owner")).trim(),
          position: cards.filter((c) => c.column_id === column.id).length,
          updated_at: new Date().toISOString(),
        });
      if (result.error) throw result.error;
      form.reset();
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
          priority: draft.priority,
          owner_email: draft.owner_email.trim(),
          counters: draft.counters,
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
        {boards.map((b) => (
          <button
            key={b.id}
            role="tab"
            aria-selected={b.id === boardId}
            className={b.id === boardId ? "ops-board active" : "ops-board"}
            onClick={() => setBoardId(b.id)}
          >
            {b.name}
            <span className="ops-board-count">{counts[b.id] || 0}</span>
          </button>
        ))}
        <button className="ops-board ops-board-new" onClick={() => setCreatingBoard(true)}>
          <Plus size={14} />
          New board
        </button>
      </div>

      {board && (
        <div className="ops-toolbar">
          <select
            aria-label="Filter by owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">All owners</option>
            {owners.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
          <span className="muted small-text">
            {visibleCards.length} card{visibleCards.length === 1 ? "" : "s"}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={() => {
              const name = window.prompt("Rename board", board.name);
              if (name === null) return;
              if (!name.trim()) {
                setError("The board name cannot be empty.");
                return;
              }
              void action(async () => {
                const result = await db()
                  .from("ops_boards")
                  .update({ name: name.trim(), updated_at: new Date().toISOString() })
                  .eq("id", board.id)
                  .select("id")
                  .single();
                if (result.error) throw result.error;
              }, "Board renamed.");
            }}
          >
            Rename board
          </button>
          <button
            className="btn danger small"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete “${board.name}” and all its columns and cards?`))
                void action(async () => {
                  const result = await db().from("ops_boards").delete().eq("id", board.id);
                  if (result.error) throw result.error;
                  setBoardId("");
                }, "Board deleted.");
            }}
          >
            <Trash2 size={14} />
            Delete board
          </button>
        </div>
      )}

      {board && (
        <div className="ops-kanban">
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
                <h2>{column.name}</h2>
                <span className="ops-column-count">{cardsOf(column.id).length}</span>
              </header>

              {cardsOf(column.id).map((card) => {
                const counters = asCounters(card.counters);
                const pct = progress(counters);
                return (
                  <article
                    key={card.id}
                    className="ops-card"
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit card ${card.title}`}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                    onClick={() => setEditing(card)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(card);
                      }
                    }}
                  >
                    <div className="ops-card-title">
                      {card.priority && (
                        <span className={`ops-priority ops-priority--${card.priority.toLowerCase()}`}>
                          {card.priority}
                        </span>
                      )}
                      <h3>{card.title}</h3>
                    </div>
                    {!!counters.length && (
                      <div className="ops-card-meta">
                        {counters.map((c, i) => (
                          <span className="ops-pill" key={i}>
                            {c.label ? `${c.label} ` : "✓ "}
                            {c.done}/{c.total}
                          </span>
                        ))}
                        {pct !== null && <span className="ops-pct">{pct}%</span>}
                      </div>
                    )}
                    {pct !== null && (
                      <div className="ops-progress" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </div>
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
                );
              })}

              {!cardsOf(column.id).length && addingTo !== column.id && (
                <p className="ops-column-empty">No cards yet</p>
              )}

              {addingTo === column.id ? (
                <form className="ops-add-form" onSubmit={(e) => void addCard(e, column)}>
                  <input
                    name="title"
                    placeholder="Card title"
                    required
                    maxLength={300}
                    autoFocus
                  />
                  <input name="owner" placeholder="Owner (email)" defaultValue={actorEmail} maxLength={200} />
                  <div className="actions">
                    <button className="btn small" disabled={busy}>
                      Add card
                    </button>
                    <button type="button" className="btn secondary small" onClick={() => setAddingTo("")}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button className="ops-add" onClick={() => setAddingTo(column.id)}>
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
        <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Create a board">
          <form className="ops-modal-card form" onSubmit={(e) => void createBoard(e)}>
            <div className="ops-modal-head">
              <h2>Create a board</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setCreatingBoard(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label>
              Board name
              <input name="name" required maxLength={200} placeholder="Sales decks" autoFocus />
            </label>
            <label>
              Description
              <textarea
                name="description"
                rows={2}
                maxLength={2000}
                placeholder="What this board tracks and how cards flow through it."
              />
            </label>
            <label>
              Columns (one per line)
              <textarea name="columns" rows={5} defaultValue={DEFAULT_COLUMNS.join("\n")} />
            </label>
            <div className="actions">
              <button className="btn" disabled={busy}>
                Create board
              </button>
              <button type="button" className="btn secondary" onClick={() => setCreatingBoard(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
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
    priority: card.priority,
    owner_email: card.owner_email,
    counters: asCounters(card.counters),
  });
  const setCounter = (index: number, patch: Partial<Counter>) =>
    setDraft((current) => ({
      ...current,
      counters: current.counters.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
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
        <fieldset className="ops-counters">
          <legend>Counters</legend>
          {draft.counters.map((counter, i) => (
            <div className="ops-counter-row" key={i}>
              <input
                value={counter.label}
                placeholder="Label (empty = ✓)"
                maxLength={40}
                onChange={(e) => setCounter(i, { label: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={counter.total}
                value={counter.done}
                aria-label="Done"
                onChange={(e) => setCounter(i, { done: Number(e.target.value) })}
              />
              <span>/</span>
              <input
                type="number"
                min={1}
                value={counter.total}
                aria-label="Total"
                onChange={(e) => setCounter(i, { total: Number(e.target.value) })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove counter"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    counters: current.counters.filter((_, j) => j !== i),
                  }))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn secondary small"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                counters: [...current.counters, { label: "", done: 0, total: 6 }],
              }))
            }
          >
            <Plus size={14} />
            Add counter
          </button>
        </fieldset>
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
