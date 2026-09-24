import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Columns3, Pencil, Plus, RefreshCw, Sparkles, Trash2, Users, X } from "lucide-react";
import { db, errorMessage, type Row } from "@quicksort/candidate-db";
import { Empty, Heading, Notice } from "./index";
import "./kanban.css";
import { MagicDesign } from "./MagicDesign";

type Project = Row<"kanban_projects">;
type Board = Row<"kanban_boards">;
type Column = Row<"kanban_columns">;
type Card = Row<"kanban_cards">;
type Panel = "project" | "board" | "edit-board" | "column" | "card" | "access" | "delete-project" | "delete-board" | null;

// Supabase caps each response; fetch all pages so larger boards are not silently truncated.
async function readAll<T>(query: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> }) {
  const data: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await query().range(offset, offset + 499);
    if (page.error) throw page.error;
    data.push(...(page.data || []));
    if ((page.data?.length || 0) < 500) return { data, error: null };
  }
}

export function KanbanWorkspace({ admin }: { admin: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Row<"profiles">[]>([]);
  const [projectMembers, setProjectMembers] = useState<Row<"kanban_project_members">[]>([]);
  const [boardMembers, setBoardMembers] = useState<Row<"kanban_board_members">[]>([]);
  const [projectId, setProjectId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [creator, setCreator] = useState("");
  const [magicOpen, setMagicOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "project" | "board"; id: string; name: string } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [columnDrafts, setColumnDrafts] = useState<{ key: string; id?: string; name: string; selected: boolean }[]>([]);
  const [cardColumn, setCardColumn] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const mutation = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const [p, b, c, t, users, pm, bm] = await Promise.all([
        readAll(() => db().from("kanban_projects").select("*").order("created_at").order("id")),
        readAll(() => db().from("kanban_boards").select("*").order("created_at").order("id")),
        readAll(() => db().from("kanban_columns").select("*").order("position").order("id")),
        readAll(() => db().from("kanban_cards").select("*").order("created_at").order("id")),
        admin ? readAll(() => db().from("profiles").select("*").order("full_name").order("id")) : Promise.resolve({ data: [], error: null }),
        admin ? readAll(() => db().from("kanban_project_members").select("*").order("project_id").order("user_id")) : Promise.resolve({ data: [], error: null }),
        admin ? readAll(() => db().from("kanban_board_members").select("*").order("board_id").order("user_id")) : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [p, b, c, t, users, pm, bm]) if (result.error) throw result.error;
      if (version !== request.current) return;
      setProjects(p.data || []); setBoards(b.data || []); setColumns(c.data || []); setCards(t.data || []);
      setPeople(users.data || []); setProjectMembers(pm.data || []); setBoardMembers(bm.data || []);
    } catch (err) {
      if (version === request.current) {
        setProjects([]); setBoards([]); setColumns([]); setCards([]);
        setPeople([]); setProjectMembers([]); setBoardMembers([]);
        setPanel(null);
        setError(errorMessage(err));
      }
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [admin]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!mutation.current) void load(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { ++request.current; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => {
    if (panel) formRef.current?.querySelector<HTMLInputElement>("input, select, textarea")?.focus();
  }, [panel]);

  const project = projects.find(p => p.id === projectId) || projects[0];
  const projectBoards = boards.filter(b => b.project_id === project?.id);
  const board = projectBoards.find(b => b.id === boardId) || projectBoards[0];
  const boardColumns = columns.filter(c => c.board_id === board?.id);
  const boardCards = cards.filter(c => c.board_id === board?.id);
  const creators = [...new Map(boardCards.map(c => [c.created_by, c.creator_name])).entries()];
  useEffect(() => {
    setPanel(null);
    setMagicOpen(false);
    setCreator("");
  }, [project?.id, board?.id]);
  const personName = (id: string) => people.find(p => p.id === id)?.full_name || people.find(p => p.id === id)?.email || "Workspace member";

  async function action(work: () => Promise<void>, success: string, close = true) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await work();
      if (close) setPanel(null);
      setMessage(success);
      await load();
    } catch (err) { setError(errorMessage(err)); }
    finally { mutation.current = false; setBusy(false); }
  }
  function open(next: Panel) {
    if (next === "board") setColumnDrafts(["To do", "In progress", "Blocked", "Done"].map(name => ({ key: crypto.randomUUID(), name, selected: true })));
    if (next === "edit-board") setColumnDrafts(boardColumns.map(c => ({ key: c.id, id: c.id, name: c.name, selected: true })));
    setPanel(next); setError(""); setMessage(""); }
  function openDelete(kind: "project" | "board") {
    const target = kind === "project" ? project : board;
    if (!admin || !target) return;
    setDeleteTarget({ kind, id: target.id, name: target.name });
    setConfirmation("");
    open(kind === "project" ? "delete-project" : "delete-board");
  }
  async function submitDelete(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!admin || !deleteTarget || confirmation !== deleteTarget.name) return;
    const target = deleteTarget;
    await action(async () => {
      const result = await db().from(target.kind === "project" ? "kanban_projects" : "kanban_boards")
        .delete().eq("id", target.id).eq("name", confirmation).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("This item changed, was already deleted, or you no longer have permission. Refresh and try again.");
      // Remove stale content immediately, even if refreshing subsequently fails.
      const removedBoardIds = new Set(target.kind === "board" ? [target.id] : boards.filter(b => b.project_id === target.id).map(b => b.id));
      if (target.kind === "project") {
        setProjects(items => items.filter(p => p.id !== target.id));
        setProjectMembers(items => items.filter(m => m.project_id !== target.id));
        setProjectId("");
      }
      setBoards(items => items.filter(b => !removedBoardIds.has(b.id)));
      setColumns(items => items.filter(c => !removedBoardIds.has(c.board_id)));
      setCards(items => items.filter(c => !removedBoardIds.has(c.board_id)));
      setBoardMembers(items => items.filter(m => !removedBoardIds.has(m.board_id)));
      setBoardId(""); setCreator(""); setConfirmation(""); setDeleteTarget(null);
    }, `${target.kind === "project" ? "Project" : "Board"} “${target.name}” deleted.`);
  }
  function changeProject(id: string) { setProjectId(id); setBoardId(""); setCreator(""); setPanel(null); }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const name = String(values.get("name") || "").trim();
    if (panel !== "access" && !name) { setError("Enter a name or title."); return; }
    const selectedColumns = columnDrafts.filter(c => c.selected);
    if (panel === "board" || panel === "edit-board") {
      if (!selectedColumns.length || selectedColumns.some(c => !c.name.trim())) { setError("Choose at least one column and give each selected column a name."); return; }
      if (new Set(selectedColumns.map(c => c.name.trim().toLowerCase())).size !== selectedColumns.length) { setError("Use a different name for each column."); return; }
    }
    await action(async () => {
      if (panel === "project") {
        const result = await db().from("kanban_projects").insert({ name }).select("*").single();
        if (result.error) throw result.error;
        setProjectId(result.data.id); setBoardId("");
      } else if ((panel === "board" || panel === "edit-board") && project) {
        const result = await db().rpc("save_kanban_board", {
          target_project: project.id, board_name: name,
          target_board: panel === "edit-board" ? board!.id : undefined,
          column_drafts: selectedColumns.map(c => ({ ...(c.id ? { id: c.id } : {}), name: c.name.trim() })),
        });
        if (result.error) throw result.error;
        setBoardId(result.data!); setCreator("");
      } else if (panel === "column" && board) {
        const result = await db().from("kanban_columns").insert({ name, board_id: board.id, position: Math.max(-1, ...boardColumns.map(c => c.position)) + 1 }).select("id").single();
        if (result.error) throw result.error;
      } else if (panel === "card" && board) {
        const result = await db().from("kanban_cards").insert({ title: name, description: String(values.get("description") || "").trim(), board_id: board.id, column_id: String(values.get("column")) }).select("id").single();
        if (result.error) throw result.error;
        setCreator("");
      } else if (panel === "access" && project) {
        const user_id = String(values.get("person"));
        const result = values.get("scope") === "project"
          ? await db().from("kanban_project_members").upsert({ user_id, project_id: project.id }, { onConflict: "project_id,user_id", ignoreDuplicates: true })
          : await db().from("kanban_board_members").upsert({ user_id, board_id: board!.id }, { onConflict: "board_id,user_id", ignoreDuplicates: true });
        if (result.error) throw result.error;
      } else throw new Error("This board is no longer available. Refresh and try again.");
    }, panel === "access" ? "Access granted." : "Saved.", panel !== "access");
  }
  function moveCard(card: Card, columnId: string) {
    if (columnId === card.column_id || !boardColumns.some(c => c.id === columnId)) return;
    void action(async () => {
      const result = await db().from("kanban_cards").update({ column_id: columnId }).eq("id", card.id).select("id").single();
      if (result.error) throw result.error;
    }, `Moved “${card.title}” to ${boardColumns.find(c => c.id === columnId)?.name}.`, false);
  }
  const deleting = panel === "delete-project" || panel === "delete-board";
  const panelTitle = deleting ? `Delete ${deleteTarget?.kind}` : panel === "project" ? "Create a project" : panel === "board" ? "Create a board" : panel === "edit-board" ? "Edit Kanban board" : panel === "column" ? "Create a column" : panel === "access" ? "Manage access" : "Create a card";

  return <section className="kanban-workspace" aria-label="Kanban workspace" aria-busy={busy || loading}>
    <Heading eyebrow="Team workspace" title="Operations board" action={<div className="kanban-actions">
      <button className="btn secondary" aria-label="Refresh boards" disabled={busy || loading} onClick={() => { setError(""); void load(); }}><RefreshCw size={16} /></button>
      {admin && <button className="btn" disabled={busy} onClick={() => open("project")}><Plus size={16} />New project</button>}
    </div>}>
      {admin ? "Organize work across projects. Give your team access to the boards they need." : "Your shared projects and boards. Create cards and keep work moving."}
    </Heading>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    {loading && <p role="status">Loading your boards…</p>}
    {!loading && !projects.length && !error && <Empty title={admin ? "A space for every project" : "No boards shared yet"}>
      {admin ? "Create your first project for sales, events, marketing, or internal work." : "Your admin can give you access to a project or a specific board."}
    </Empty>}
    {!!projects.length && <>
      <nav className="kanban-projects" aria-label="Projects">{projects.map(p => <button key={p.id} disabled={busy} className={p.id === project?.id ? "active" : ""} aria-current={p.id === project?.id ? "page" : undefined} onClick={() => changeProject(p.id)}>{p.name}<span>{boards.filter(b => b.project_id === p.id).length}</span></button>)}</nav>
      <div className="kanban-toolbar">
        <label>Board<select value={board?.id || ""} disabled={busy || !projectBoards.length} onChange={e => { setBoardId(e.target.value); setCreator(""); setPanel(null); }}>
          {!projectBoards.length && <option value="">No boards yet</option>}{projectBoards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
        {board && <label>Card creator<select value={creator} onChange={e => setCreator(e.target.value)}><option value="">All card creators</option>{creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        {admin && <div className="kanban-actions"><button className="btn secondary" disabled={busy} onClick={() => open("board")}><Plus size={16} />New board</button><button className="btn secondary" disabled={busy} onClick={() => open("access")}><Users size={16} />Manage access</button><button className="btn secondary kanban-danger" disabled={busy} onClick={() => openDelete("project")}><Trash2 size={16} />Delete project</button></div>}
      </div>
    </>}
    {panel && <section className="panel kanban-editor" aria-label={panelTitle}>
      <div className="panel-head"><h2>{panelTitle}</h2><button className="btn secondary" aria-label="Close form" disabled={busy} onClick={() => setPanel(null)}><X size={16} /></button></div>
      {deleting && deleteTarget ? <form ref={formRef} className="form" onSubmit={submitDelete}>
        <fieldset disabled={busy}>
          <p id="kanban-delete-warning">Permanently delete {deleteTarget.kind} <strong>{deleteTarget.name}</strong>? {deleteTarget.kind === "project" ? "All boards in this project, their columns, cards, and access grants will also be deleted." : "All columns, cards, and access grants for this board will also be deleted."} This cannot be undone.</p>
          <label>Type “{deleteTarget.name}” to confirm<input name="confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="off" spellCheck={false} aria-describedby="kanban-delete-warning kanban-delete-hint" /></label>
          <p id="kanban-delete-hint" className="muted">The name must match exactly, including capital letters and spaces.</p>
          <div className="kanban-actions"><button className="btn secondary" type="button" onClick={() => setPanel(null)}>Cancel</button><button className="btn kanban-danger-solid" type="submit" disabled={busy || confirmation !== deleteTarget.name}>{busy ? "Deleting…" : `Permanently delete ${deleteTarget.kind}`}</button></div>
        </fieldset>
      </form> : <form ref={formRef} className="form" key={`${panel}-${project?.id}-${board?.id}`} onSubmit={submit}>
        <fieldset disabled={busy}>
          {panel !== "access" ? <label>{panel === "card" ? "Card title" : "Name"}<input name="name" defaultValue={panel === "edit-board" ? board?.name : undefined} required maxLength={panel === "card" ? 200 : 100} placeholder={panel === "project" ? "e.g. Events" : panel === "board" ? "e.g. Paris launch" : panel === "column" ? "e.g. On hold" : "What needs to be done?"} /></label> : <>
            <p className="muted">Project access includes every current and future board. Board access includes only the selected board. Everyone needs an explicit grant in the candidate portal, including admins and creators. Admins manage all boards only in the admin portal.</p>
            <label>Person<select name="person" required defaultValue=""><option value="" disabled>Select a person</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email} · {p.email}</option>)}</select></label>
            <label>Access level<select name="scope"><option value="project">Entire project: {project?.name}</option>{board && <option value="board">Only this board: {board.name}</option>}</select></label>
          </>}
          {(panel === "board" || panel === "edit-board") && <fieldset className="kanban-column-editor">
            <legend>Columns</legend>
            <p className="muted">{panel === "board" ? "Choose your starting columns, rename them, or add your own." : "Rename columns here. Existing cards stay in their columns, and candidates see the updated names."}</p>
            {columnDrafts.map((column, index) => <div className="kanban-column-draft" key={column.key}>
              {!column.id && <input type="checkbox" aria-label={`Include column ${index + 1}`} checked={column.selected} onChange={e => setColumnDrafts(items => items.map(c => c.key === column.key ? { ...c, selected: e.target.checked } : c))} />}
              <label>Column {index + 1}<input value={column.name} disabled={!column.selected} required={column.selected} maxLength={100} onChange={e => setColumnDrafts(items => items.map(c => c.key === column.key ? { ...c, name: e.target.value } : c))} /></label>
            </div>)}
            <button className="btn secondary" type="button" onClick={() => setColumnDrafts(items => [...items, { key: crypto.randomUUID(), name: "", selected: true }])}><Plus size={16} />Add another column</button>
          </fieldset>}
          {panel === "card" && <><label>Description<textarea name="description" maxLength={4000} rows={3} /></label><label>Column<select name="column" defaultValue={cardColumn || boardColumns[0]?.id} required>{boardColumns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><p className="muted">Your name will be recorded automatically as the creator.</p></>}
          <button className="btn" type="submit">{busy ? "Saving…" : panel === "access" ? "Grant access" : "Save"}</button>
        </fieldset>
      </form>}
      {panel === "access" && <div className="kanban-grants">
        <h3>Project access</h3>
        {!projectMembers.some(m => m.project_id === project?.id) && <p className="muted">No project grants yet.</p>}
        {projectMembers.filter(m => m.project_id === project?.id).map(m => <div className="list-row" key={m.user_id}><span>{personName(m.user_id)}</span><button className="btn secondary" disabled={busy} onClick={() => void action(async () => {
          const result = await db().from("kanban_project_members").delete().eq("project_id", m.project_id).eq("user_id", m.user_id).select("user_id").single();
          if (result.error) throw result.error;
        }, "Project access removed. Any separate board grants still apply.", false)}>Revoke project access</button></div>)}
        {board && <><h3>Direct access to {board.name}</h3><p className="muted">Project members also have access to this board.</p>{boardMembers.filter(m => m.board_id === board.id).map(m => <div className="list-row" key={m.user_id}><span>{personName(m.user_id)}</span><button className="btn secondary" disabled={busy} onClick={() => void action(async () => {
          const result = await db().from("kanban_board_members").delete().eq("board_id", m.board_id).eq("user_id", m.user_id).select("user_id").single();
          if (result.error) throw result.error;
        }, "Board grant removed. Project access, if granted, still applies.", false)}>Revoke board access</button></div>)}</>}
      </div>}
    </section>}
    {board && <>
      <div className="kanban-board-heading"><div><h2><Columns3 size={20} />{board.name}</h2><p className="kanban-creator">{board.creator_name ? `Created by ${board.creator_name}` : "Creator not recorded for this older board"}</p><p className="muted">{boardCards.length} {boardCards.length === 1 ? "card" : "cards"} · Drag a card or use its column selector to move it.</p></div><div className="kanban-actions">{admin && <button className="btn secondary small" disabled={busy || !boardColumns.length} onClick={() => setMagicOpen(true)}><Sparkles size={15} />Magic design</button>}{admin && <><button className="btn secondary" disabled={busy} onClick={() => open("edit-board")}><Pencil size={16} />Edit Kanban board</button><button className="btn secondary" disabled={busy} onClick={() => open("column")}><Plus size={16} />Add column</button><button className="btn secondary kanban-danger" disabled={busy} onClick={() => openDelete("board")}><Trash2 size={16} />Delete board</button></>}</div></div>
      <div className="kanban-columns" aria-label={`${board.name} columns`}>
        {boardColumns.map(column => {
          const visibleCards = boardCards.filter(c => c.column_id === column.id && (!creator || c.created_by === creator));
          return <section className="kanban-column" key={column.id} aria-label={column.name} onDragOver={e => { if (!busy) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const card = boardCards.find(c => c.id === e.dataTransfer.getData("text/plain")); if (card && !busy) moveCard(card, column.id); }}>
            <header><h3>{column.name}</h3><span>{visibleCards.length}</span></header>
            {visibleCards.map(card => <article className="kanban-card" key={card.id} draggable={!busy} onDragStart={e => { e.dataTransfer.setData("text/plain", card.id); e.dataTransfer.effectAllowed = "move"; }}>
              <h4>{card.title}</h4>{card.description && <p className="kanban-description">{card.description}</p>}
              <span className="kanban-creator" title={`Created by ${card.creator_name}`}>Created by {card.creator_name}</span>
              <label className="kanban-move">Move to<select aria-label={`Move ${card.title}`} value={card.column_id} disabled={busy} onChange={e => moveCard(card, e.target.value)}>{boardColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            </article>)}
            {!visibleCards.length && <p className="kanban-empty">{creator ? "No matching cards" : "No cards yet"}</p>}
            <button className="kanban-add" disabled={busy} onClick={() => { setCardColumn(column.id); open("card"); }}><Plus size={16} />Add a card</button>
          </section>;
        })}
      </div>
      {!boardColumns.length && <Empty title="This board needs a column">{admin ? "Add a column to start creating cards." : "Your admin will set up the columns for this board."}</Empty>}
    </>}
    {admin && magicOpen && board && <MagicDesign key={board.id} boardId={board.id} boardName={board.name} columns={boardColumns} onClose={() => setMagicOpen(false)} onSaved={count => { setMagicOpen(false); setCreator(""); setMessage(`${count} ${count === 1 ? "card" : "cards"} added.`); void load(); }} />}
    {project && !board && !loading && <Empty title="No boards in this project">{admin ? "Create a board for your first event, initiative, or workstream." : "Your admin has not shared a board here yet."}</Empty>}
  </section>;
}
