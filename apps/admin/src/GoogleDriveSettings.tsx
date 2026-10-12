import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { Notice } from "@quicksort/hr-ui";
import "./settings-page.css";

type Status = {
  configured: boolean;
  updatedAt: string | null;
  canSave: boolean;
  unreadable?: boolean;
  serviceAccountEmail?: string;
  rootFolderName?: string;
};

/**
 * Settings → Google Drive contracts. Card layout (reference Settings
 * design): ruled header with the connection pill, service-account JSON and
 * root-folder rows, footer with the lime Connect action. Portal owners
 * connect the shared Google service account (the JSON key is stored
 * encrypted, server-side, and is never displayed again); every admin can
 * then upload project contracts and annexes from Sales → Projects →
 * Contract. The contracts root folder ("Contrats_Clients") must be shared
 * with the service-account email (Editor) — the save step looks the folder
 * up, which proves the share.
 */
export function GoogleDriveSettings({ isOwner }: { isOwner: boolean }) {
  const { session } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [rootFolderId, setRootFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function request(method = "GET", body?: unknown) {
    const token = await session?.getToken({ template: "supabase" });
    if (!token) throw new Error("Sign in again to manage the Google Drive connection.");
    const response = await fetch("/api/google-drive", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("The Google Drive service is unavailable. Deploy the updated admin app first.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The Google Drive request failed.");
    return result;
  }

  useEffect(() => {
    void request()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the Google Drive status."));
  }, [session?.id]);

  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = (await request(
        remove ? "DELETE" : "PUT",
        remove ? undefined : { serviceAccountJson: serviceAccountJson.trim(), rootFolderId: rootFolderId.trim() },
      )) as { rootFolderName?: string };
      setServiceAccountJson("");
      setRootFolderId("");
      setStatus(await request());
      setMessage(
        remove
          ? "Google Drive connection removed."
          : `Google Drive connected — contracts go to “${result.rootFolderName || "Contrats_Clients"}”.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the Google Drive connection.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = !status && !!error;
  const configured = !!status?.configured;
  const pillClass = unavailable ? " sp-pill--danger" : configured ? " sp-pill--ok" : "";
  const statusLabel = unavailable ? "Unavailable" : !status ? "Checking…" : configured ? "Connected" : "Not connected";
  const footStatus = !status
    ? "Checking connection…"
    : configured
      ? `Service account ${status.serviceAccountEmail || "(saved)"} connected${
          status.rootFolderName ? `, root folder “${status.rootFolderName}”` : ""
        }${status.updatedAt ? ` — saved ${new Date(status.updatedAt).toLocaleString()}` : ""}.`
      : "No Google Drive service account connected yet.";

  return (
    <div className="settings-stack">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <section className="sp-card" aria-label="Google Drive contracts">
        <header className="sp-card-head sp-card-head--ruled">
          <div>
            <h2 className="sp-card-title">Google Drive contracts</h2>
            <p className="sp-card-desc">
              Store project contracts on Google Drive: one folder per contract (named{" "}
              <strong>Client/Contract</strong>) under the shared <strong>Contrats_Clients</strong>{" "}
              root, with the contract and its annexes inside. Uploads happen from{" "}
              <strong>Sales → Projects → Contract</strong>.
            </p>
          </div>
          <span className={`sp-pill${pillClass}`} role="status">
            <span className="sp-pill-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </header>

        {unavailable && (
          <p className="sp-alert" role="alert">
            The Google Drive service is unavailable. Deploy the updated admin app first.
          </p>
        )}

        {!isOwner ? (
          <p className="sp-note" role="status">
            {configured
              ? "Google Drive is connected — contracts are stored there. Only portal owners can manage the connection."
              : "Google Drive is not connected yet. Ask a portal owner to connect the service account."}
          </p>
        ) : (
          <>
            {/* Service account row */}
            <div className="sp-row">
              <div>
                <div className="sp-row-label">Service account JSON key</div>
                <div className="sp-row-hint">The key is stored encrypted and never shown again.</div>
              </div>
              <div className="sp-controls">
                <textarea
                  className="sp-area"
                  rows={5}
                  value={serviceAccountJson}
                  onChange={e => setServiceAccountJson(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder='{"type":"service_account","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----…"}'
                  aria-label="Service account JSON key"
                />
                <p className="sp-row-hint">
                  In{" "}
                  <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">
                    Google Cloud → IAM → Service accounts
                  </a>
                  , create a key for a service account (enable the Google Drive API for the project), then share your{" "}
                  <strong>Quicksort/Contrats_Clients</strong> Drive folder with the service-account email as{" "}
                  <strong>Editor</strong>.
                </p>
              </div>
            </div>

            {/* Root folder row */}
            <div className="sp-row">
              <div>
                <div className="sp-row-label">Root folder ID</div>
                <div className="sp-row-hint">Optional</div>
              </div>
              <input
                className="sp-input"
                value={rootFolderId}
                onChange={e => setRootFolderId(e.target.value)}
                placeholder="Leave empty to use the single “Contrats_Clients” folder"
                aria-label="Root folder ID"
              />
            </div>

            <footer className="sp-foot">
              <span className="sp-row-hint" role="status">{footStatus}</span>
              <span className="sp-inline">
                {configured && (
                  <button
                    type="button"
                    className="sp-btn-danger"
                    disabled={busy}
                    onClick={() => confirm("Remove the Google Drive connection?") && void save(true)}
                  >
                    Remove
                  </button>
                )}
                <button type="button" className="sp-btn" disabled={busy || !serviceAccountJson.trim()} onClick={() => void save()}>
                  {busy ? "Saving…" : configured ? "Replace key" : "Connect"}
                </button>
              </span>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
