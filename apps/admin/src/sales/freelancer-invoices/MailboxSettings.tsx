import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, Button, Input } from "@quicksort-sas/ui";
import { PageAlerts } from "../../ui";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "../../settings-ui";
import { errorText } from "./api";
import type { FreelancerInvoicesApi, MailboxSettingsResponse, SyncResult } from "./api";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function syncSummary(r: SyncResult): string {
  const poll = "messages" in r.poll
    ? `${r.poll.invoices} new invoice${r.poll.invoices === 1 ? "" : "s"} from ${r.poll.messages} email${r.poll.messages === 1 ? "" : "s"}${r.poll.duplicates ? `, ${r.poll.duplicates} duplicate${r.poll.duplicates === 1 ? "" : "s"}` : ""}${r.poll.notInvoices ? `, ${r.poll.notInvoices} other attachment${r.poll.notInvoices === 1 ? "" : "s"} skipped` : ""}${r.poll.failed ? `, ${r.poll.failed} failed` : ""}${r.poll.partial ? " (more left for the next run)" : ""}`
    : `Mailbox not read: ${r.poll.skipped}`;
  return `${poll}. ${r.matched} paid from Qonto, ${r.suggested} payment${r.suggested === 1 ? "" : "s"} to confirm, ${r.reviewed} approved.`;
}

/**
 * Freelancer invoices → Settings: the mailbox read for invoices (through the
 * Drive service account, by domain-wide delegation), the first date read,
 * the last run and a manual run.
 */
export function MailboxSettings({ api, onSynced }: { api: FreelancerInvoicesApi; onSynced: () => void }) {
  const [settings, setSettings] = useState<MailboxSettingsResponse | null>(null);
  const [address, setAddress] = useState("");
  const [backfillFrom, setBackfillFrom] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api.get<MailboxSettingsResponse>({ resource: "settings" });
      setSettings(s);
      setAddress(s.mailbox);
      setBackfillFrom(s.backfillFrom ?? "");
    } catch (e) { setError(errorText(e, "Could not load the mailbox settings.")); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (busy) return;
    setBusy("save"); setError(""); setMessage("");
    try {
      await api.post("save_mailbox", { address: address.trim(), backfillFrom });
      setMessage("Mailbox settings saved.");
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }

  async function sync() {
    if (busy) return;
    setBusy("sync"); setError(""); setMessage("");
    try {
      setMessage(syncSummary(await api.post<SyncResult>("sync")));
      onSynced();
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }

  const dirty = !!settings && (address.trim().toLowerCase() !== settings.mailbox || backfillFrom !== (settings.backfillFrom ?? ""));
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) && DAY.test(backfillFrom);
  const locked = busy !== null;

  return (
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <SettingsCard
        title="Invoice mailbox"
        description="Freelancers email their invoices here. Only PDFs from a known freelancer address are read."
        action={settings && (
          settings.lastError ? <ConnectionBadge tone="danger">Last run failed</ConnectionBadge>
            : settings.lastPolledAt ? <ConnectionBadge tone="ok">Read {when(settings.lastPolledAt)}</ConnectionBadge>
            : <ConnectionBadge tone="neutral">Never read</ConnectionBadge>
        )}
        footer={(
          <>
            <Button variant="outline" disabled={locked} onClick={() => void sync()}>
              <RefreshCw data-icon="inline-start" className={busy === "sync" ? "animate-spin" : undefined} /> {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
            <Button disabled={locked || !dirty || !valid} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</Button>
          </>
        )}
      >
        {!settings ? (
          !error && <p role="status" className="m-0 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <SettingsRow label="Mailbox address" hint="The Google Workspace inbox invoices arrive in.">
              <Input aria-label="Mailbox address" type="email" value={address} disabled={locked} onChange={(e) => setAddress(e.target.value)} />
            </SettingsRow>
            <SettingsRow label="Read from" hint="Emails received before this date are ignored.">
              <Input aria-label="Read from" type="date" className="max-w-48" value={backfillFrom} disabled={locked} onChange={(e) => setBackfillFrom(e.target.value)} />
            </SettingsRow>
            <SettingsRow label="Last run">
              <span className="text-sm">{when(settings.lastPolledAt)}</span>
              {settings.lastError && (
                <Alert variant="destructive" role="alert"><AlertDescription>{settings.lastError}</AlertDescription></Alert>
              )}
            </SettingsRow>
            <SettingsRow label="Setup" hint="Once, by a Google Workspace super admin.">
              <Hint>
                In Google Workspace Admin → Security → Access and data control → API controls → Manage domain-wide delegation,
                add the service account's client ID with the scope <code className="break-all">{GMAIL_SCOPE}</code>.
              </Hint>
              <Hint>
                Service account:{" "}
                {settings.driveServiceAccountEmail
                  ? <strong className="break-all">{settings.driveServiceAccountEmail}</strong>
                  : "connect Google Drive first, in Settings → Google Drive."}
              </Hint>
            </SettingsRow>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
