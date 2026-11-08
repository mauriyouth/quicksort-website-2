import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { RefreshCw } from "lucide-react";
import { Button, Input, InputGroup, InputGroupAddon, InputGroupText, NativeSelect, NativeSelectOption } from "@quicksort-sas/ui";
import { PageAlerts } from "./ui";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "./settings-ui";

type Status = { configured: boolean; source: string; model: string; updatedAt: string | null; canSave: boolean };

/**
 * Settings → AI configuration (SettingsCard on @quicksort-sas/ui): ruled
 * header with the connection badge and refresh, an API-key row that flips
 * between the masked saved key and the replacement input, a model row, and
 * a footer whose lime button stays disabled until something is dirty. All state still talks to /api/ai-settings; the saved key is
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
  const [testing, setTesting] = useState(false);
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
      setMessage(remove ? "Saved key removed. A server-configured key, if present, will be used." : apiKey.trim() ? "API key and model saved securely. The CV analyzer will use them on its next run." : "Model saved. The CV analyzer will use it with your existing API key on its next run.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  async function testConnection() {
    setBusy(true); setTesting(true); setError(""); setMessage("");
    try {
      const result = await request("/api/ai-settings", "POST", { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), model }) as { model: string };
      setMessage(`Connection successful: ${result.model} is accessible. Testing does not save changes.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not test the connection."); }
    finally { setBusy(false); setTesting(false); }
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
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <SettingsCard
        title="AI configuration"
        description="Connect OpenAI to run candidate evaluations in the CV analyzer."
        action={
          <>
            <ConnectionBadge tone={configured ? "ok" : "neutral"}>{statusLabel}</ConnectionBadge>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void refresh().catch(e => setError(e instanceof Error ? e.message : "Could not refresh status."))}
              disabled={!isOwner}
              title="Refresh status"
              aria-label="Refresh status"
            >
              <RefreshCw />
            </Button>
          </>
        }
        footer={
          isOwner && (
            <>
              <Hint className="max-w-md">Saving makes no AI request. Test connection sends a small paid request with the entered key, or your saved key if left blank, and checks access.</Hint>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy || !status || (!configured && !keyLooksValid) || !model.trim()} onClick={() => void testConnection()}>
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                <Button variant="pivot" disabled={!canSubmit} onClick={() => void save()}>
                  {saveLabel}
                </Button>
              </div>
            </>
          )
        }
      >
        {!isOwner ? (
          <Hint>Ask a portal owner to configure the shared AI key.</Hint>
        ) : (
          <>
            <SettingsRow
              label="OpenAI API key"
              hint={
                <>
                  Stored encrypted. The saved key is never displayed again.
                  {status && !status.canSave && (
                    <span className="mt-1 block">Secure storage needs a one-time server setup: configure AI_SETTINGS_ENCRYPTION_KEY before saving a key here.</span>
                  )}
                </>
              }
            >
              {showSavedKey && (
                <InputGroup>
                  <InputGroupAddon align="inline-start"><InputGroupText className="font-mono">sk-••••••••••••••••</InputGroupText></InputGroupAddon>
                  <InputGroupAddon align="inline-end" className="ml-auto gap-1">
                    <Button
                      size="xs"
                      variant={confirmRemove ? "destructive" : "ghost"}
                      className={confirmRemove ? undefined : "text-destructive"}
                      disabled={busy}
                      onClick={() => (confirmRemove ? void save(true) : setConfirmRemove(true))}
                      onBlur={() => setConfirmRemove(false)}
                    >
                      {confirmRemove ? "Confirm remove" : "Remove"}
                    </Button>
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => { setReplacing(true); setConfirmRemove(false); }}>
                      Replace
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              )}
              {showKeyInput && (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    className="flex-1"
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={1000}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={configured ? "Paste a replacement key" : "sk-…"}
                    disabled={busy || loadingModels || !status?.canSave}
                    aria-label="OpenAI API key"
                  />
                  {configured && (
                    <Button variant="outline" disabled={busy} onClick={() => { setReplacing(false); setApiKey(""); }}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
              <a className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                Create an OpenAI API key ↗
              </a>
            </SettingsRow>

            <SettingsRow label="Model" hint="Must support PDFs and structured output.">
              <div className="flex gap-2">
                {models ? (
                  <NativeSelect
                    className="flex-1"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    disabled={busy || !status?.canSave}
                    aria-label="Model"
                  >
                    {(model && !models.includes(model) ? [model, ...models] : models).map(id => <NativeSelectOption key={id} value={id}>{id}</NativeSelectOption>)}
                  </NativeSelect>
                ) : (
                  <Input
                    className="flex-1 font-mono"
                    required
                    maxLength={120}
                    pattern="[a-zA-Z0-9._\-]+"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    disabled={busy || !status?.canSave}
                    aria-label="Model"
                  />
                )}
                <Button
                  variant="outline"
                  disabled={busy || loadingModels || !keyLooksValid || !status?.canSave}
                  onClick={() => void loadModels()}
                >
                  {loadingModels ? "Loading…" : models ? "Reload list" : "Load models"}
                </Button>
              </div>
              <Hint>
                {models
                  ? `${models.length} models available to your key.`
                  : "Load the list to pick from the models your key can access."}
              </Hint>
              <PageAlerts error={modelsError} />
            </SettingsRow>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
