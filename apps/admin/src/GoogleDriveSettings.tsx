import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Alert,
  AlertDescription,
  Button,
  Input,
  Textarea,
} from "@quicksort-sas/ui";
import { PageAlerts } from "./ui";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "./settings-ui";

type Status = {
  configured: boolean;
  updatedAt: string | null;
  canSave: boolean;
  unreadable?: boolean;
  serviceAccountEmail?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  peopleRootFolderId?: string | null;
  peopleRootFolderName?: string | null;
  recruitmentRootFolderId?: string | null;
  recruitmentRootFolderName?: string | null;
  companyRootFolderId?: string | null;
  companyRootFolderName?: string | null;
};

/**
 * Settings → Google Drive contracts (SettingsCard on @quicksort-sas/ui):
 * ruled header with the connection badge, service-account JSON and
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
  const [peopleRootFolderId, setPeopleRootFolderId] = useState("");
  const [recruitmentRootFolderId, setRecruitmentRootFolderId] = useState("");
  const [companyRootFolderId, setCompanyRootFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

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

  /** Shows the saved folders in the inputs, so the current value stays visible. */
  function applyStatus(next: Status) {
    setStatus(next);
    setRootFolderId(next.rootFolderId || "");
    setPeopleRootFolderId(next.peopleRootFolderId || "");
    setRecruitmentRootFolderId(next.recruitmentRootFolderId || "");
    setCompanyRootFolderId(next.companyRootFolderId || "");
  }

  useEffect(() => {
    void request()
      .then(applyStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the Google Drive status."));
  }, [session?.id]);

  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = (await request(
        remove ? "DELETE" : "PUT",
        remove
          ? undefined
          : {
              ...(serviceAccountJson.trim() ? { serviceAccountJson: serviceAccountJson.trim() } : {}),
              rootFolderId: rootFolderId.trim(),
              peopleRootFolderId: peopleRootFolderId.trim(),
              recruitmentRootFolderId: recruitmentRootFolderId.trim(),
              companyRootFolderId: companyRootFolderId.trim(),
            },
      )) as { rootFolderName?: string; peopleRootFolderName?: string | null; recruitmentRootFolderName?: string | null; companyRootFolderName?: string | null };
      setServiceAccountJson("");
      applyStatus(await request());
      setMessage(
        remove
          ? "Google Drive connection removed."
          : `Google Drive connected. Contracts go to "${result.rootFolderName || "Contrats_Clients"}"${
              result.peopleRootFolderName ? `, HR documents to "${result.peopleRootFolderName}"` : ""
            }${result.recruitmentRootFolderName ? `, candidate CVs to "${result.recruitmentRootFolderName}"` : ""}${
              result.companyRootFolderName ? `, company documents to "${result.companyRootFolderName}"` : ""
            }.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the Google Drive connection.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = !status && !!error;
  const configured = !!status?.configured;
  const tone = unavailable ? "danger" : configured ? "ok" : "neutral";
  const statusLabel = unavailable ? "Unavailable" : !status ? "Checking…" : configured ? "Connected" : "Not connected";
  const footStatus = !status
    ? "Checking connection…"
    : configured
      ? `Service account ${status.serviceAccountEmail || "(saved)"} connected${
          status.rootFolderName ? `, root folder "${status.rootFolderName}"` : ""
        }${status.peopleRootFolderName ? `, HR folder "${status.peopleRootFolderName}"` : ", no HR folder yet"}${
          status.recruitmentRootFolderName ? `, CV folder "${status.recruitmentRootFolderName}"` : ""
        }${status.companyRootFolderName ? `, company folder "${status.companyRootFolderName}"` : ""}${status.updatedAt ? `, saved ${new Date(status.updatedAt).toLocaleString()}` : ""}.`
      : "No Google Drive service account connected yet.";

  const canSave = !(busy || !(serviceAccountJson.trim() || (configured && (rootFolderId.trim() || peopleRootFolderId.trim() || recruitmentRootFolderId.trim() || companyRootFolderId.trim()))));
  return (
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the Google Drive connection?</AlertDialogTitle>
            <AlertDialogDescription>Contracts, HR documents, CVs and company documents can no longer be uploaded until a service account is connected again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmRemove(false); void save(true); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SettingsCard
        title="Google Drive contracts"
        description={
          <Hint className="text-sm">
            Store project contracts on Google Drive: one folder per contract (named <strong>Client/Contract</strong>) under the shared{" "}
            <strong>Contrats_Clients</strong> root, with the contract and its annexes inside. Employee documents go to a separate,
            HR-only folder, and candidate CVs to a recruitment folder. Uploads happen from <strong>Sales → Projects</strong>,{" "}
            <strong>HR → Employment</strong> and <strong>HR → Add person</strong>.
          </Hint>
        }
        action={<ConnectionBadge tone={tone}>{statusLabel}</ConnectionBadge>}
        footer={
          isOwner && (
            <>
              <Hint role="status" className="max-w-md">{footStatus}</Hint>
              <div className="flex flex-wrap gap-2">
                {configured && (
                  <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )}
                <Button variant="pivot" disabled={!canSave} onClick={() => void save()}>
                  {busy ? "Saving…" : !configured ? "Connect" : serviceAccountJson.trim() ? "Replace key" : "Save folders"}
                </Button>
              </div>
            </>
          )
        }
      >
        {unavailable && (
          <Alert variant="destructive" role="alert" className="mb-5">
            <AlertDescription>The Google Drive service is unavailable. Deploy the updated admin app first.</AlertDescription>
          </Alert>
        )}
        {!isOwner ? (
          <Hint role="status">
            {configured
              ? "Google Drive is connected, and contracts are stored there. Only portal owners can manage the connection."
              : "Google Drive is not connected yet. Ask a portal owner to connect the service account."}
          </Hint>
        ) : (
          <>
            <SettingsRow label="Service account JSON key" hint="The key is stored encrypted and never shown again.">
              <Textarea
                className="min-h-28 font-mono text-xs md:text-xs"
                rows={5}
                value={serviceAccountJson}
                onChange={e => setServiceAccountJson(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder='{"type":"service_account","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----…"}'
                aria-label="Service account JSON key"
              />
              <Hint>
                In{" "}
                <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">
                  Google Cloud → IAM → Service accounts
                </a>
                , create a key for a service account (enable the Google Drive API for the project), then share your{" "}
                <strong>Quicksort/Contrats_Clients</strong> Drive folder with the service-account email as <strong>Editor</strong>.
              </Hint>
            </SettingsRow>

            <SettingsRow label="Root folder ID or URL" hint={status?.rootFolderName ? `Current: "${status.rootFolderName}"` : "Optional"}>
              <Input
                value={rootFolderId}
                onChange={e => setRootFolderId(e.target.value)}
                placeholder="Leave empty to use the single &quot;Contrats_Clients&quot; folder"
                aria-label="Root folder ID"
              />
            </SettingsRow>

            <SettingsRow
              label="HR documents folder ID or URL"
              hint={status?.peopleRootFolderName ? `Current: "${status.peopleRootFolderName}"` : "Needed for employee documents"}
            >
              <Input
                value={peopleRootFolderId}
                onChange={e => setPeopleRootFolderId(e.target.value)}
                placeholder="ID of the Collaborateurs folder"
                aria-label="HR documents folder ID"
              />
              <Hint>
                Identity cards, cartes Vitale and employment contracts are filed here, one folder per person. Share it with the
                service account and <strong>HR only</strong>, never with the whole domain. The ID is the last part of the folder URL.
              </Hint>
            </SettingsRow>

            <SettingsRow
              label="Candidate CVs folder ID or URL"
              hint={status?.recruitmentRootFolderName ? `Current: "${status.recruitmentRootFolderName}"` : "Needed to file CVs from the hiring pipeline"}
            >
              <Input
                value={recruitmentRootFolderId}
                onChange={e => setRecruitmentRootFolderId(e.target.value)}
                placeholder="ID or URL of the CVs folder"
                aria-label="Candidate CVs folder ID"
              />
              <Hint>
                CVs added in <strong>HR → Add person</strong> are filed as <strong>year / position / Candidate.pdf</strong> (or{" "}
                <strong>Candidatures spontanées</strong> without a position), and copied when a person is linked to a position. The
                folder must sit in a Shared Drive and be shared with the service account.
              </Hint>
            </SettingsRow>

            <SettingsRow
              label="Company documents folder ID or URL"
              hint={status?.companyRootFolderName ? `Current: "${status.companyRootFolderName}"` : "Needed for Operations → Admin"}
            >
              <Input
                value={companyRootFolderId}
                onChange={e => setCompanyRootFolderId(e.target.value)}
                placeholder="ID or URL of the company admin folder"
                aria-label="Company documents folder ID"
              />
              <Hint>
                Quicksort's own papers, filed from <strong>Operations → Admin</strong>: attestation de régularité fiscale, attestation
                de vigilance URSSAF, extrait Kbis, assurances, and bilans (annual and intermediate, by year). Use a Shared Drive folder
                shared with the service account and the admins.
              </Hint>
            </SettingsRow>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
