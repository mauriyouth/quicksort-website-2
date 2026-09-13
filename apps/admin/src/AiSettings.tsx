import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { Notice } from "@quicksort/candidate-ui";
type Status = { configured: boolean; source: string; model: string; updatedAt: string | null; canSave: boolean };
export function AiSettings({ isOwner }: { isOwner: boolean }) {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function request(method = "GET", body?: unknown) {
    const token = await session?.getToken();
    if (!token) throw new Error("Sign in again to configure AI.");
    const response = await fetch("/api/ai-settings", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("AI settings are unavailable. Deploy the updated admin app first.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update settings.");
    return result;
  }
  async function refresh() { const next = await request() as Status; setStatus(next); setModel(next.model); }
  useEffect(() => { if (isOwner) void refresh().catch(e => setError(e.message)); }, [isOwner, session?.id]);
  async function save(remove = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      await request(remove ? "DELETE" : "PUT", remove ? undefined : { apiKey, model });
      setApiKey("");
      await refresh();
      setMessage(remove ? "Saved key removed. A server-configured key, if present, will be used." : "API key saved securely. The CV analyzer will use it on its next run.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  return <section className="panel" style={{ maxWidth: 700 }} aria-label="AI configuration">
    <h2>AI configuration</h2><p className="muted">Connect OpenAI to power candidate evaluations in the CV analyzer.</p>
    {!isOwner ? <p>Ask a portal owner to configure the shared AI key.</p> : <>
      <Notice error>{error}</Notice><Notice>{message}</Notice>
      <p role="status">{status ? status.configured ? `API key configured (${status.source === "settings" ? "saved in settings" : "server configuration"}).` : "No API key configured." : "Checking configuration…"}</p>
      {status && !status.canSave && <p className="muted">Secure storage needs a one-time server setup: configure AI_SETTINGS_ENCRYPTION_KEY before saving a key here.</p>}
      <form className="form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>OpenAI API key<input type="password" autoComplete="new-password" spellCheck={false} required minLength={20} maxLength={1000} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "Enter a replacement key" : "sk-…"} disabled={busy || !status?.canSave} /></label>
        <p className="muted small-text">Stored encrypted. The saved key is never displayed again. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Create an OpenAI API key</a>.</p>
        <label>Model<input required maxLength={120} pattern="[a-zA-Z0-9._-]+" value={model} onChange={e => setModel(e.target.value)} disabled={busy || !status?.canSave} /></label>
        <p className="muted small-text">Use a model that supports PDFs and structured output. Saving does not make a paid AI request; the first analysis verifies provider access.</p>
        <div className="actions"><button className="btn" disabled={busy || !status?.canSave}>{busy ? "Saving…" : status?.configured ? "Replace API key" : "Save API key"}</button>{status?.source === "settings" && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save(true)}>Remove saved key</button>}<button type="button" className="btn secondary" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Refresh status</button></div>
      </form>
    </>}
  </section>;
}
