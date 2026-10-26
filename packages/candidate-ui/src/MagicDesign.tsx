import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles, X } from "lucide-react";
import { db, errorMessage, getSessionToken } from "@quicksort/candidate-db";

type Draft = { id: string; title: string; description: string; columnId: string };
type Props = { boardId: string; boardName: string; columns: { id: string; name: string }[]; onClose(): void; onSaved(count: number): void };

export function MagicDesign({ boardId, boardName, columns, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => { controller.current?.abort(); element.close(); opener?.focus(); };
  }, []);
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !prompt.trim()) return;
    pending.current = true; setBusy("generate"); setError("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("Sign in again to use Magic design.");
      const response = await fetch("/api/generate-cards", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ boardId, prompt }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(105000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Cards could not be generated.");
      if (!Array.isArray(result.cards) || !result.cards.length || result.cards.length > 20 || result.cards.some((card: Draft) => typeof card.title !== "string" || !card.title.trim() || card.title.length > 200 || typeof card.description !== "string" || card.description.length > 4000 || !columns.some(column => column.id === card.columnId))) throw new Error("The generated cards were incomplete. Try again.");
      setDrafts(result.cards.map((card: Draft) => ({ ...card, id: crypto.randomUUID() })));
    } catch (err) { if (!abort.signal.aborted) setError(errorMessage(err)); }
    finally { pending.current = false; setBusy(null); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !drafts.length) return;
    pending.current = true; setBusy("save"); setError("");
    try {
      const result = await db().from("kanban_cards").insert(drafts.map(card => ({ board_id: boardId, column_id: card.columnId, title: card.title.trim(), description: card.description.trim() })));
      if (result.error) throw result.error;
      onSaved(drafts.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { pending.current = false; setBusy(null); }
  }
  function update(index: number, patch: Partial<Draft>) { setDrafts(items => items.map((item, i) => i === index ? { ...item, ...patch } : item)); }
  return <dialog ref={dialog} className="kanban-magic-dialog" aria-labelledby="magic-title" aria-describedby="magic-description" onCancel={event => { event.preventDefault(); if (busy !== "save") onClose(); }}>
    <div className="panel-head"><h2 id="magic-title"><Sparkles size={20} />Magic design</h2><button className="btn secondary small" aria-label="Close Magic design" disabled={busy === "save"} onClick={onClose}><X size={18} /></button></div>
    <p id="magic-description" className="muted">Turn your instructions into cards for <strong>{boardName}</strong>. Review and edit them before adding them.</p>
    <form className="form" onSubmit={generate}>
      <label htmlFor="magic-prompt">What would you like to create?</label>
      <textarea id="magic-prompt" autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} required maxLength={6000} rows={5} disabled={!!busy} placeholder="Create 5 cards for our Paris launch. Write in French, with a short checklist for each task. Put them in To do." />
      <p className="muted">Describe the tasks, number of cards, language, and details to include. Up to 20 cards at a time.</p>
      <button className="btn" disabled={!!busy || !prompt.trim()}><Sparkles size={16} />{busy === "generate" ? "Creating your drafts…" : drafts.length ? "Generate again" : "Generate cards"}</button>
    </form>
    {busy && <p role="status">{busy === "generate" ? "Following your instructions…" : "Adding cards to your board…"}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {!!drafts.length && <form className="form kanban-magic-drafts" onSubmit={save}>
      <h3>{drafts.length} {drafts.length === 1 ? "card" : "cards"} to review</h3>
      <fieldset disabled={!!busy}>
        {drafts.map((card, index) => <div className="kanban-magic-draft" key={card.id}>
          <label>Card {index + 1} title<input value={card.title} maxLength={200} required onChange={event => update(index, { title: event.target.value })} /></label>
          <label>Description<textarea rows={3} value={card.description} maxLength={4000} onChange={event => update(index, { description: event.target.value })} /></label>
          <label>Column<select value={card.columnId} onChange={event => update(index, { columnId: event.target.value })}>{columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
          <button type="button" className="btn secondary small" onClick={() => setDrafts(items => items.filter(item => item.id !== card.id))}>Remove card {index + 1}</button>
        </div>)}
        <button className="btn" disabled={drafts.some(card => !card.title.trim())}>Add {drafts.length} {drafts.length === 1 ? "card" : "cards"} to board</button>
      </fieldset>
    </form>}
  </dialog>;
}
