import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { Notice } from "@quicksort/hr-ui";
import "./settings-page.css";

type Status = { configured: boolean; updatedAt: string | null; canSave: boolean };
type ImportResult = { created: number; updated: number; skipped: number; total: number };

/**
 * Settings → Import from BoondManager. Portal owners connect the shared
 * BoondManager account (credentials are stored encrypted, server-side, and
 * are never displayed again); any admin can then pull clients into
 * Sales → Clients, employees into HR → Employees and candidates into
 * HR → Talent pool. Re-running an import updates matched records instead of
 * duplicating them.
 */
export function BoondImport({ isOwner }: { isOwner: boolean }) {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [instance, setInstance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [clients, setClients] = useState<ImportResult | null>(null);
  const [employees, setEmployees] = useState<ImportResult | null>(null);
  const [candidates, setCandidates] = useState<ImportResult | null>(null);

  async function request(method = "GET", body?: unknown) {
    const token = await session?.getToken({ template: "supabase" });
    if (!token) throw new Error("Sign in again to manage imports.");
    const response = await fetch("/api/boondmanager", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("The import service is unavailable. Deploy the updated admin app first.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The BoondManager request failed.");
    return result;
  }

  async function refresh() {
    setStatus((await request()) as Status);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load the connection status."));
  }, [session?.id]);

  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(
        remove ? "DELETE" : "PUT",
        remove ? undefined : { username, password, instance: instance.trim() },
      );
      setUsername("");
      setPassword("");
      await refresh();
      setMessage(
        remove
          ? "BoondManager connection removed."
          : "BoondManager account saved. The import buttons below are ready.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport(kind: "clients" | "employees" | "candidates") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = (await request("POST", { kind })) as ImportResult;
      const summary = `${result.created} created · ${result.updated} updated · ${result.skipped} skipped (of ${result.total} found in BoondManager)`;
      if (kind === "clients") setClients(result);
      else if (kind === "employees") setEmployees(result);
      else setCandidates(result);
      setMessage(
        kind === "clients"
          ? `Clients imported. ${summary}`
          : kind === "employees"
            ? `Employees imported. ${summary}`
            : `Candidates imported. ${summary}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sp-card" aria-label="Import from BoondManager">
      <header className="sp-card-head sp-card-head--ruled">
        <div>
          <h2 className="sp-card-title">Import from BoondManager</h2>
          <p className="sp-card-desc">
            Pull clients into <strong>Sales → Clients</strong>, employees into{" "}
            <strong>HR → Employees</strong> and candidates into <strong>HR → Talent pool</strong>{" "}
            from your BoondManager account. Imports match on name (clients) or
            email/name (people), so re-running one updates existing records instead
            of creating duplicates.
          </p>
        </div>
      </header>
      <div className="sp-body">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      {isOwner ? (
        <>
          <p role="status">
            {status
              ? status.configured
                ? `BoondManager account connected${status.updatedAt ? ` (saved ${new Date(status.updatedAt).toLocaleString()})` : ""}.`
                : "No BoondManager account connected yet."
              : "Checking connection…"}
          </p>
          {!status?.canSave && (
            <p className="muted">
              Secure storage needs a one-time server setup: configure
              AI_SETTINGS_ENCRYPTION_KEY before saving credentials here.
            </p>
          )}
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="form-columns">
              <label>
                BoondManager username
                <input
                  autoComplete="off"
                  required
                  maxLength={200}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy || !status?.canSave}
                />
              </label>
              <label>
                BoondManager password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={200}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || !status?.canSave}
                />
              </label>
            </div>
            <label>
              Instance host
              <input
                required
                maxLength={120}
                pattern="[a-z0-9.-]+"
                placeholder="yourcompany.boondmanager.com"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                disabled={busy || !status?.canSave}
              />
              <span className="muted">
                Your BoondManager tenant — the host in your browser's address bar when
                you use Boond (e.g. <code>acme.boondmanager.com</code>). REST API access
                must be allowed in Boond (settings → security).{" "}
                <a href="https://doc.boondmanager.com/api-externe/" target="_blank" rel="noreferrer">
                  API documentation
                </a>
                .
              </span>
            </label>
            <p className="muted small-text">
              Stored encrypted; the saved password is never displayed again.
            </p>
            <div className="actions">
              <button className="btn" disabled={busy || !status?.canSave}>
                {busy ? "Saving…" : status?.configured ? "Replace connection" : "Save connection"}
              </button>
              {status?.configured && (
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void save(true)}>
                  Remove connection
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        <p>Ask a portal owner to connect the shared BoondManager account.</p>
      )}

      <h3 style={{ marginTop: 24 }}>Run an import</h3>
      <div className="actions">
        <button className="btn secondary" disabled={busy || !status?.configured} onClick={() => void runImport("clients")}>
          Import clients
        </button>
        <button className="btn secondary" disabled={busy || !status?.configured} onClick={() => void runImport("employees")}>
          Import employees
        </button>
        <button className="btn secondary" disabled={busy || !status?.configured} onClick={() => void runImport("candidates")}>
          Import candidates
        </button>
      </div>
      {(clients || employees || candidates) && (
        <ul className="muted small-text" style={{ marginTop: 12, paddingLeft: 18 }}>
          {clients && (
            <li>
              Clients: {clients.created} created · {clients.updated} updated · {clients.skipped} skipped (of {clients.total} found)
            </li>
          )}
          {employees && (
            <li>
              Employees: {employees.created} created · {employees.updated} updated · {employees.skipped} skipped (of {employees.total} found)
            </li>
          )}
          {candidates && (
            <li>
              Candidates: {candidates.created} created · {candidates.updated} updated · {candidates.skipped} skipped (of {candidates.total} found)
            </li>
          )}
        </ul>
      )}
      </div>
    </section>
  );
}
