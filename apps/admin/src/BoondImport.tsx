import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input } from "@quicksort-sas/ui";
import { PageAlerts } from "./ui";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "./settings-ui";

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

  const results = [
    ["Clients", clients],
    ["Employees", employees],
    ["Candidates", candidates],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <SettingsCard
        title="Import from BoondManager"
        description={
          <Hint className="text-sm">
            Pull clients into <strong>Sales → Clients</strong>, employees into <strong>HR → Employees</strong> and candidates into{" "}
            <strong>HR → Talent pool</strong> from your BoondManager account. Imports match on name (clients) or email/name (people),
            so re-running one updates existing records instead of creating duplicates.
          </Hint>
        }
        action={
          status && (
            <ConnectionBadge tone={status.configured ? "ok" : "neutral"}>{status.configured ? "Connected" : "Not connected"}</ConnectionBadge>
          )
        }
      >
        <SettingsRow
          label="Connection"
          hint={
            isOwner ? (
              <span role="status">
                {status
                  ? status.configured
                    ? `BoondManager account connected${status.updatedAt ? ` (saved ${new Date(status.updatedAt).toLocaleString()})` : ""}.`
                    : "No BoondManager account connected yet."
                  : "Checking connection…"}
              </span>
            ) : undefined
          }
        >
          {isOwner ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <FieldGroup className="gap-4">
                {!status?.canSave && (
                  <Hint>Secure storage needs a one-time server setup: configure AI_SETTINGS_ENCRYPTION_KEY before saving credentials here.</Hint>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="boond-username">BoondManager username</FieldLabel>
                    <Input
                      id="boond-username"
                      autoComplete="off"
                      required
                      maxLength={200}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy || !status?.canSave}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="boond-password">BoondManager password</FieldLabel>
                    <Input
                      id="boond-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      maxLength={200}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy || !status?.canSave}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="boond-instance">Instance host</FieldLabel>
                  <Input
                    id="boond-instance"
                    required
                    maxLength={120}
                    pattern="[a-z0-9.\-]+"
                    placeholder="yourcompany.boondmanager.com"
                    value={instance}
                    onChange={(e) => setInstance(e.target.value)}
                    disabled={busy || !status?.canSave}
                  />
                  <FieldDescription>
                    Your BoondManager tenant — the host in your browser's address bar when you use Boond (e.g.{" "}
                    <code>acme.boondmanager.com</code>). REST API access must be allowed in Boond (settings → security).{" "}
                    <a href="https://doc.boondmanager.com/api-externe/" target="_blank" rel="noreferrer">
                      API documentation
                    </a>
                    .
                  </FieldDescription>
                </Field>
                <Hint>Stored encrypted; the saved password is never displayed again.</Hint>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || !status?.canSave}>
                    {busy ? "Saving…" : status?.configured ? "Replace connection" : "Save connection"}
                  </Button>
                  {status?.configured && (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>
                      Remove connection
                    </Button>
                  )}
                </div>
              </FieldGroup>
            </form>
          ) : (
            <Hint>Ask a portal owner to connect the shared BoondManager account.</Hint>
          )}
        </SettingsRow>

        <SettingsRow label="Run an import" hint="Re-running updates matched records.">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !status?.configured} onClick={() => void runImport("clients")}>
              Import clients
            </Button>
            <Button variant="outline" disabled={busy || !status?.configured} onClick={() => void runImport("employees")}>
              Import employees
            </Button>
            <Button variant="outline" disabled={busy || !status?.configured} onClick={() => void runImport("candidates")}>
              Import candidates
            </Button>
          </div>
          {results.some(([, r]) => r) && (
            <ul className="m-0 flex flex-col gap-1 p-0 text-xs text-muted-foreground">
              {results.map(
                ([label, r]) =>
                  r && (
                    <li key={label} className="list-none">
                      <span className="text-foreground">{label}:</span>{" "}
                      <span className="num">
                        {r.created} created · {r.updated} updated · {r.skipped} skipped (of {r.total} found)
                      </span>
                    </li>
                  ),
              )}
            </ul>
          )}
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
