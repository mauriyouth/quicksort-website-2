import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, Eye, GripVertical, Heading2, Italic, Link2, List, PenLine, Plus, Search, Trash2, Users, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card as UiCard,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@quicksort-sas/ui";
import { cn } from "cn";
import {
  db,
  errorMessage,
  isMissingRelationError,
  type Row,
} from "@quicksort/hr-db";
import { EmptyState, PageAlerts } from "../ui";
import "./ops.css";

/**
 * Operations board: custom kanban boards (ops.md §1). Boards own ordered
 * columns; cards carry a title, free-form Markdown content, a priority and an
 * owner. Cards move by drag-and-drop or via the move control in the card
 * editor — same explicit fallback pattern as the sales pipeline board.
 *
 * Rendered for admins (every board) and, in the employee portal, for
 * employees: RLS returns only the boards they own or that are shared with
 * them (20261220090000_ops_boards_employee_access.sql). The owner (or an
 * admin) renames and shares a board; everyone on it works its cards.
 */
type Board = Row<"ops_boards">;
type Share = Row<"ops_board_shares">;
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

export function OpsBoard({
  actorEmail,
  actorId,
  isAdmin,
}: {
  actorEmail: string;
  actorId: string;
  isAdmin: boolean;
}) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [shares, setShares] = useState<Share[]>([]); // shares of the open board
  const [sharing, setSharing] = useState(false); // share dialog open
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
      setShares([]);
      return;
    }
    try {
      const [columnsResult, cardsResult, sharesResult] = await Promise.all([
        db().from("ops_columns").select("*").eq("board_id", id).order("position"),
        db().from("ops_cards").select("*").eq("board_id", id).order("position"),
        db().from("ops_board_shares").select("*").eq("board_id", id).order("email"),
      ]);
      if (columnsResult.error) throw columnsResult.error;
      if (cardsResult.error) throw cardsResult.error;
      setColumns(columnsResult.data || []);
      setCards(cardsResult.data || []);
      // Sharing arrives with its own migration; the board still works without it.
      setShares(sharesResult.error ? [] : sharesResult.data || []);
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
    document.title = isAdmin ? "Operations board · Quicksort Admin" : "Board · Quicksort";
    void load();
  }, [load, isAdmin]);

  useEffect(() => {
    setSearch("");
    setSharing(false);
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
  /** Owner or admin: may rename and share the board. */
  const canManage = (b: Board) => isAdmin || (!!b.owner_id && b.owner_id === actorId);
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
          owner_id: actorId,
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
    }, `Board "${name}" created.`);
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
      setMessage(`"${card.title}" is assigned to ${card.owner_email}. Open it to reassign.`);
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
    }, next ? `"${card.title}" assigned to you.` : `"${card.title}" unassigned.`);
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
    }, `"${card.title}" moved to ${columns.find((c) => c.id === columnId)?.name || "column"}.`);
  }

  if (notMigrated) {
    return (
      <EmptyState title="Operations boards are not set up yet">
        Apply the ops boards migration (20261005090000_ops_boards.sql) to this
        Supabase project, then refresh.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Boards">
        {boards.map((b) =>
          renamingBoard === b.id ? (
            <Input
              key={b.id}
              className="h-8 w-48 shrink-0 rounded-full px-3 text-sm font-medium md:text-sm"
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
            <Button
              key={b.id}
              role="tab"
              aria-selected={b.id === boardId}
              variant={b.id === boardId ? "outline" : "ghost"}
              size="sm"
              className={cn(
                "shrink-0 gap-2 rounded-full pr-3 pl-1",
                b.id === boardId ? "bg-card text-foreground" : "text-muted-foreground",
              )}
              title={canManage(b) ? "Click to open · double-click to rename" : "Shared with you"}
              onClick={() => setBoardId(b.id)}
              onDoubleClick={() => canManage(b) && setRenamingBoard(b.id)}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold",
                  b.id === boardId ? "bg-foreground text-background" : "bg-muted text-foreground",
                )}
                aria-hidden="true"
              >
                {firstInitial(b.name)}
              </span>
              <span className="max-w-44 truncate">{b.name}</span>
              {!isAdmin && b.owner_id !== actorId && (
                <Users className="size-3.5 opacity-60" aria-label="Shared with you" />
              )}
              <span className="num text-xs opacity-60">{counts[b.id] || 0}</span>
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-full border-dashed text-muted-foreground"
          onClick={() => setCreatingBoard(true)}
        >
          <Plus data-icon="inline-start" />
          New board
        </Button>
      </div>

      {!loading && !boards.length && (
        <EmptyState title="No boards yet">
          Use "New board" above to create one, set its columns, then add cards.
          {!isAdmin && " Boards a colleague shares with you appear here too."}
        </EmptyState>
      )}

      {board && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <InputGroup className="h-9 w-full sm:w-64">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              className="text-sm md:text-sm"
              aria-label="Search tickets or filter by owner"
              placeholder="Search title or owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <span className="num">
            {search.trim()
              ? `${visibleCards.length} of ${cards.length} cards`
              : `${visibleCards.length} card${visibleCards.length === 1 ? "" : "s"}`}
          </span>
          {selectedId && (
            <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
              <Kbd>Space</Kbd> assign to me · <Kbd>Enter</Kbd> edit · <Kbd>Esc</Kbd> deselect
            </span>
          )}
          {canManage(board) ? (
            <Button
              variant="outline"
              size="sm"
              className={cn(!selectedId && "ml-auto")}
              onClick={() => setSharing(true)}
            >
              <Users data-icon="inline-start" />
              {shares.length ? `Shared with ${shares.length}` : "Share"}
            </Button>
          ) : (
            <span className={cn("inline-flex items-center gap-1.5", !selectedId && "ml-auto")}>
              <Users className="size-3.5" aria-hidden="true" />
              Shared with you
            </span>
          )}
        </div>
      )}

      {board && (
        <div
          className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-3"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest("[data-board-card]")) setSelectedId("");
          }}
        >
          {columns.map((column) => (
            <section
              key={column.id}
              className={cn(
                "flex min-h-36 w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/60 p-2 transition-shadow",
                dragOver === column.id && "ring-2 ring-foreground/25 ring-inset",
              )}
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
              <header className="flex min-h-8 items-center justify-between gap-2 border-b border-border px-1.5 pb-2">
                {renamingColumn === column.id ? (
                  <Input
                    className="h-7 min-w-0 flex-1 px-2 font-mono text-xs tracking-[0.06em] uppercase md:text-xs"
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
                    className="label-mono m-0 -ml-1 cursor-default truncate rounded-sm px-1 py-0.5 text-foreground select-none hover:bg-accent"
                    title="Double-click to rename"
                    onDoubleClick={() => setRenamingColumn(column.id)}
                  >
                    {column.name}
                  </h2>
                )}
                <Badge variant="secondary" className="num shrink-0">
                  {cardsOf(column.id).length}
                </Badge>
              </header>

              {cardsOf(column.id).map((card) => (
                <UiCard
                  key={card.id}
                  size="sm"
                  data-board-card=""
                  className={cn(
                    "cursor-grab gap-2 py-3 transition-[border-color,box-shadow] outline-none hover:border-faint focus-visible:ring-2 focus-visible:ring-ring/30 active:cursor-grabbing",
                    selectedId === card.id && "border-foreground ring-1 ring-foreground hover:border-foreground",
                  )}
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
                  <div className="flex flex-col gap-2 px-3">
                    <div className="flex items-start gap-2">
                      {card.priority && (
                        <Badge variant={PRIORITY_BADGE[card.priority] ?? "secondary"} className="mt-0.5 shrink-0">
                          {card.priority}
                        </Badge>
                      )}
                      <h3 className="m-0 min-w-0 text-sm leading-snug font-medium [overflow-wrap:anywhere]">{card.title}</h3>
                    </div>
                    {!!card.content.trim() && (
                      <p className="m-0 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {card.content.trim().split(/\r?\n/)[0]}
                      </p>
                    )}
                    {card.owner_email && (
                      <p className="m-0 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <Avatar size="sm" aria-hidden="true">
                          <AvatarFallback>{initials(card.owner_email)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate">{card.owner_email}</span>
                      </p>
                    )}
                  </div>
                </UiCard>
              ))}

              {!cardsOf(column.id).length && (
                <p className="m-0 rounded-md border border-dashed border-border px-2 py-5 text-center text-xs text-muted-foreground">
                  No cards yet
                </p>
              )}

              {addingTo === column.id ? (
                <Input
                  className="h-9 bg-card text-sm md:text-sm"
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
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                  onClick={() => {
                    quickCancel.current = false;
                    setQuickTitle("");
                    setAddingTo(column.id);
                  }}
                >
                  <Plus data-icon="inline-start" />
                  Add a card
                </Button>
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
              }, `Column "${name}" added.`)
            }
          />
        </div>
      )}

      {sharing && board && (
        <ShareDialog
          board={board}
          shares={shares}
          actorEmail={actorEmail}
          busy={busy}
          onClose={() => setSharing(false)}
          onAdd={(email) =>
            action(async () => {
              const result = await db()
                .from("ops_board_shares")
                .insert({ board_id: board.id, email });
              if (result.error) throw result.error;
            }, `"${board.name}" shared with ${email}.`)
          }
          onRemove={(email) =>
            void action(async () => {
              const result = await db()
                .from("ops_board_shares")
                .delete()
                .eq("board_id", board.id)
                .eq("email", email);
              if (result.error) throw result.error;
            }, `${email} removed from "${board.name}".`)
          }
        />
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
          columnId={cards.find((c) => c.id === editing.id)?.column_id ?? editing.column_id}
          columns={columns}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(draft) => void saveCard(draft)}
          onMove={(columnId) => void moveCard(cards.find((c) => c.id === editing.id) ?? editing, columnId)}
          onDelete={() => {
            const card = editing;
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
 * Share a board with colleagues by email. Suggestions come from
 * ops_share_directory() (open employments + admins); any address is
 * accepted so a share can be prepared before the account exists.
 */
function ShareDialog({
  board,
  shares,
  actorEmail,
  busy,
  onClose,
  onAdd,
  onRemove,
}: {
  board: Board;
  shares: Share[];
  actorEmail: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (email: string) => Promise<void>;
  onRemove: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [people, setPeople] = useState<{ email: string; full_name: string }[]>([]);
  useEffect(() => {
    void db()
      .rpc("ops_share_directory")
      .then((r) => setPeople(r.error ? [] : r.data || []));
  }, []);
  const shared = new Set(shares.map((s) => s.email));
  const me = actorEmail.toLowerCase();
  const suggestions = people.filter((p) => p.email !== me && !shared.has(p.email));
  const nameOf = (address: string) => people.find((p) => p.email === address)?.full_name;
  const next = email.trim().toLowerCase();
  const valid = /^[^@\s]+@[^@\s]+$/.test(next) && next !== me && !shared.has(next);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{board.name}"</DialogTitle>
          <DialogDescription>
            People you add can see this board and add, edit and move its cards.
            Only you can rename or re-share it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || busy) return;
            void onAdd(next).then(() => setEmail(""));
          }}
        >
          <Input
            type="email"
            list="ops-share-people"
            className="min-w-0 flex-1"
            value={email}
            maxLength={200}
            placeholder="name@quicksort.fr"
            aria-label="Colleague email"
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
          <datalist id="ops-share-people">
            {suggestions.map((p) => (
              <option key={p.email} value={p.email}>
                {p.full_name}
              </option>
            ))}
          </datalist>
          <Button type="submit" disabled={busy || !valid}>
            Share
          </Button>
        </form>
        {shares.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {shares.map((s) => (
              <li key={s.email} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1.5 text-sm">
                <Avatar size="sm" aria-hidden="true">
                  <AvatarFallback>{initials(s.email)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">
                  {nameOf(s.email) ? <>{nameOf(s.email)} <span className="text-muted-foreground">{s.email}</span></> : s.email}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`Remove ${s.email}`}
                  title="Remove access"
                  disabled={busy}
                  onClick={() => onRemove(s.email)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">Not shared with anyone yet.</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRIORITY_BADGE: Record<string, "destructive" | "warning" | "secondary"> = {
  P1: "destructive",
  P2: "warning",
  P3: "secondary",
};

/**
 * Create-a-board dialog: board name, optional description, a
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form
          className="grid min-w-0 gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create a board</DialogTitle>
            <DialogDescription>Cards move left to right through the columns you set here.</DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="ops-cb-name">Board name</FieldLabel>
            <Input
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
          </Field>

          <Field>
            <FieldLabel htmlFor="ops-cb-description">
              Description <span className="font-normal text-muted-foreground">Optional</span>
            </FieldLabel>
            <Textarea
              id="ops-cb-description"
              className="min-h-16"
              value={description}
              maxLength={2000}
              placeholder="What this board tracks and how cards flow through it."
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">Columns</span>
              <span className="text-xs text-muted-foreground">Enter adds a column · drag to reorder</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-input">
              {columns.map((column, i) => (
                <div
                  key={column.id}
                  className={cn(
                    "flex items-center gap-2 border-b border-border pr-1 pl-2 transition-colors",
                    dragIndex === i && "opacity-40",
                    overIndex === i && dragIndex !== null && dragIndex !== i && "bg-muted",
                  )}
                  draggable
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
                  <GripVertical className="size-4 shrink-0 cursor-grab text-faint" aria-hidden="true" />
                  <span className="num w-5 shrink-0 text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <Input
                    data-col-input={column.id}
                    className="h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 shadow-none hover:border-0 focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`Remove column ${i + 1}`}
                    onClick={() => removeAt(i)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full justify-start rounded-none text-muted-foreground"
                onClick={() => insertAfter(columns.length - 1, [""])}
              >
                <Plus data-icon="inline-start" />
                Add column
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <div className="flex gap-2 overflow-x-auto rounded-lg bg-muted p-3">
              {validColumns.map((columnName, i) => (
                <div key={i} className="flex w-28 flex-none flex-col gap-1.5 rounded-md bg-background p-2">
                  <span className="label-mono truncate text-foreground">{columnName}</span>
                  <span className="h-4 rounded-sm bg-muted" />
                  <span className="h-4 rounded-sm bg-muted" style={{ opacity: i % 2 ? 0 : 1 }} />
                </div>
              ))}
              {!validColumns.length && (
                <span className="py-4 text-xs text-muted-foreground">
                  Add a column to see the board take shape.
                </span>
              )}
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <span className="text-xs text-muted-foreground">{footerHint}</span>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="pivot" disabled={busy || !canCreate}>
                Create board
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      <Button
        variant="outline"
        className="h-36 w-72 shrink-0 border-dashed text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus data-icon="inline-start" />
        New column
      </Button>
    );
  return (
    <form
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/60 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name")).trim();
        if (!name) return;
        void onCreate(name).then(() => setOpen(false));
      }}
    >
      <Input
        name="name"
        className="h-9 bg-card text-sm md:text-sm"
        placeholder={`Column ${columnCount + 1}`}
        aria-label="New column name"
        required
        maxLength={200}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          Add column
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <span className="px-1 text-xs text-muted-foreground">Board: {board.name}</span>
    </form>
  );
}

/**
 * Minimal Markdown field: a textarea with a small formatting toolbar
 * (heading, bold, italic, list, link) and a Write/Preview toggle that
 * renders the value with react-markdown (GFM).
 */
function MarkdownField({
  id,
  label,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  id: string;
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
    <Field>
      <div className="flex flex-wrap items-center gap-1">
        <FieldLabel htmlFor={id} className="w-full sm:mr-auto sm:w-auto">
          {label}
        </FieldLabel>
        {tools.map(({ icon: Icon, label: toolLabel, run }) => (
          <Button
            key={toolLabel}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={toolLabel}
            title={toolLabel}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} /* keep textarea focus */
            onClick={run}
          >
            <Icon />
          </Button>
        ))}
        <Button type="button" variant="outline" size="xs" className="ml-1" onClick={() => setPreview((p) => !p)}>
          {preview ? <PenLine data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {preview ? "Write" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <div className="ops-md-preview min-h-32 rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-sm">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <span className="text-muted-foreground">Nothing to preview yet.</span>
          )}
        </div>
      ) : (
        <Textarea
          id={id}
          ref={ref}
          className="max-h-[40dvh] min-h-32 text-sm md:text-sm"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function CardEditor({
  card,
  columnId,
  columns,
  busy,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  card: Card;
  columnId: string;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
          <DialogDescription className="sr-only">Edit the card's title, content, priority, owner and column.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5">
          <Field>
            <FieldLabel htmlFor="ops-editor-title">Title</FieldLabel>
            <Input
              id="ops-editor-title"
              value={draft.title}
              maxLength={300}
              autoFocus
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <MarkdownField
            id="ops-editor-content"
            label={<>
              Content <span className="font-normal text-muted-foreground">Optional · Markdown</span>
            </>}
            value={draft.content}
            maxLength={20000}
            placeholder="Specs, notes, links. The body of the card."
            onChange={(content) => setDraft({ ...draft, content })}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ops-editor-priority">Priority</FieldLabel>
              <NativeSelect
                id="ops-editor-priority"
                className="w-full"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {p || "None"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="ops-editor-owner">Owner</FieldLabel>
              <Input
                id="ops-editor-owner"
                value={draft.owner_email}
                maxLength={200}
                placeholder="name@quicksort.fr"
                onChange={(e) => setDraft({ ...draft, owner_email: e.target.value })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ops-editor-column">Move to</FieldLabel>
            <NativeSelect
              id="ops-editor-column"
              className="w-full"
              value={columnId}
              disabled={busy}
              onChange={(e) => onMove(e.target.value)}
            >
              {columns.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !draft.title.trim()} onClick={() => onSave(draft)}>
              Save card
            </Button>
          </div>
        </DialogFooter>

        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{card.title}"?</AlertDialogTitle>
              <AlertDialogDescription>The card and its content are removed from the board. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete();
                }}
              >
                Delete card
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
