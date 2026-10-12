import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { RefreshCw } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import "./settings-page.css";

type Status = { configured: boolean; source: string; model: string; updatedAt: string | null; canSave: boolean };

/**
 * Settings → AI configuration. Card layout (reference Settings design):
 * ruled header with the connection pill and refresh, an API-key row that
 * flips between the masked saved key and the replacement input, a model
 * row, and a footer whose lime button stays disabled until something is
 * dirty. All state still talks to /api/ai-settings; the saved key is
 * never displayed again.
 */
export function AiSettings({ isOwner }: { isOwner: boolean }) {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function request(path: string, method = "GET", body?: unknown) {
    const token = await session?.getToken({ template: "supabase" });
    if (!token) throw new Error("Sign in again to configure AI.");
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("AI settings are unavailable. Deploy the updated admin app first.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update settings.");
    return result;
  }
  async function refresh() { const next = await request("/api/ai-settings") as Status; setStatus(next); setModel(next.model); }
  useEffect(() => { if (isOwner) void refresh().catch(e => setError(e.message)); }, [isOwner, session?.id]);
  async function loadModels() {
    setLoadingModels(true); setModelsError(""); setMessage("");
    try {
      const result = await request("/api/ai-models", "POST", { apiKey: apiKey.trim() }) as { models: string[] };
      setModels(result.models);
      if (result.models.length && !result.models.includes(model)) setModel(result.models[0]);
      setMessage(`Loaded ${result.models.length} models from OpenAI. Pick one below.`);
    } catch (e) { setModelsError(e instanceof Error ? e.message : "Could not load models."); }
    finally { setLoadingModels(false); }
  }
  // With a key typed, it must look valid; otherwise a model-only save needs
  // a key already configured (saved here or on the server).
  const keyLooksValid = apiKey.trim().length >= 20;
  const configured = !!status?.configured;
  const modelDirty = !!status && model !== status.model;
  const dirty = keyLooksValid || modelDirty;
  const canSubmit = Boolean(status?.canSave) && !busy && (keyLooksValid || (modelDirty && configured));
  const showSavedKey = configured && !replacing;
  const showKeyInput = !configured || replacing;
  async function save(remove = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      await request("/api/ai-settings", remove ? "DELETE" : "PUT", remove ? undefined : { apiKey: keyLooksValid ? apiKey.trim() : undefined, model });
      setApiKey(""); setReplacing(false); setConfirmRemove(false);
      await refresh();
      setMessage(remove ? "Saved key removed. A server-configured key, if present, will be used." : "API key saved securely. The CV analyzer will use it on its next run.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  const statusLabel = !status ? "Checking…" : configured ? "Key configured" : "Not configured";
  const saveLabel = busy
    ? "Saving…"
    : !dirty
      ? "Saved ✓"
      : !configured
        ? "Save API key"
        : keyLooksValid
          ? "Replace API key"
          : "Save model";
  return (
    <div className="settings-stack">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <section className="sp-card" aria-label="AI configuration">
        <header className="sp-card-head sp-card-head--ruled">
          <div>
            <h2 className="sp-card-title">AI configuration</h2>
            <p className="sp-card-desc">Connect OpenAI to power candidate evaluations in the CV analyzer.</p>
          </div>
          <div className="sp-head-actions">
            <span className={`sp-pill${configured ? " sp-pill--ok" : ""}`} role="status">
              <span className="sp-pill-dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <button
              type="button"
              className="sp-icon-btn"
              onClick={() => void refresh().catch(e => setError(e instanceof Error ? e.message : "Could not refresh status."))}
              disabled={!isOwner}
              title="Refresh status"
              aria-label="Refresh status"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        {!isOwner ? (
          <p className="sp-note">Ask a portal owner to configure the shared AI key.</p>
        ) : (
          <>
            {/* API key row */}
            <div className="sp-row">
              <div>
                <div className="sp-row-label">OpenAI API key</div>
                <div className="sp-row-hint">Stored encrypted. The saved key is never displayed again.</div>
                {status && !status.canSave && (
                  <div className="sp-row-hint">
                    Secure storage needs a one-time server setup: configure AI_SETTINGS_ENCRYPTION_KEY before saving a key here.
                  </div>
                )}
              </div>
              <div className="sp-controls">
                {showSavedKey && (
                  <div className="sp-keybox">
                    <code>sk-••••••••••••••••</code>
                    <span className="sp-keybox-actions">
                      <button
                        type="button"
                        className="sp-btn-danger"
                        disabled={busy}
                        onClick={() => (confirmRemove ? void save(true) : setConfirmRemove(true))}
                        onBlur={() => setConfirmRemove(false)}
                      >
                        {confirmRemove ? "Confirm remove" : "Remove"}
                      </button>
                      <button type="button" className="sp-btn-ghost sp-btn-sm" disabled={busy} onClick={() => { setReplacing(true); setConfirmRemove(false); }}>
                        Replace
                      </button>
                    </span>
                  </div>
                )}
                {showKeyInput && (
                  <div className="sp-inline">
                    <input
                      type="password"
                      className="sp-input sp-grow"
                      autoComplete="new-password"
                      spellCheck={false}
                      maxLength={1000}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={configured ? "Paste a replacement key" : "sk-…"}
                      disabled={busy || loadingModels || !status?.canSave}
                    />
                    {configured && (
                      <button type="button" className="sp-btn-ghost" disabled={busy} onClick={() => { setReplacing(false); setApiKey(""); }}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
                <a className="sp-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                  Create an OpenAI API key ↗
                </a>
              </div>
            </div>

            {/* Model row */}
            <div className="sp-row">
              <div>
                <div className="sp-row-label">Model</div>
                <div className="sp-row-hint">Must support PDFs and structured output.</div>
              </div>
              <div className="sp-controls">
                <div className="sp-inline">
                  {models ? (
                    <span className="sp-select-wrap sp-grow">
                      <select
                        className="sp-select"
                        value={model}
                        onChange={e => setModel(e.target.value)}
                        disabled={busy || !status?.canSave}
                        aria-label="Model"
                      >
                        {(model && !models.includes(model) ? [model, ...models] : models).map(id => <option key={id} value={id}>{id}</option>)}
                      </select>
                      <span className="sp-caret" aria-hidden="true">▾</span>
                    </span>
                  ) : (
                    <input
                      className="sp-input sp-grow"
                      required
                      maxLength={120}
                      pattern="[a-zA-Z0-9._-]+"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      disabled={busy || !status?.canSave}
                      aria-label="Model"
                    />
                  )}
                  <button
                    type="button"
                    className="sp-btn-ghost"
                    disabled={busy || loadingModels || !keyLooksValid || !status?.canSave}
                    onClick={() => void loadModels()}
                  >
                    {loadingModels ? "Loading…" : models ? "Reload list" : "Load models"}
                  </button>
                </div>
                <p className="sp-row-hint">
                  {models
                    ? `${models.length} models available to your key.`
                    : "Load the list to pick from the models your key can access."}
                </p>
                <Notice error>{modelsError}</Notice>
              </div>
            </div>

            <footer className="sp-foot">
              <span className="sp-row-hint">Saving does not make a paid AI request; the first analysis verifies provider access.</span>
              <button type="button" className="sp-btn" disabled={!canSubmit} onClick={() => void save()}>
                {saveLabel}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
