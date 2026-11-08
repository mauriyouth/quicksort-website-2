import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@quicksort-sas/ui";
import { getSessionToken } from "@quicksort/hr-db";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { COMPANY_OWNER } from "../documents/client";
import { PageHeading } from "../ui";

/**
 * Operations → Admin: Quicksort's own compliance file, the papers clients and
 * public buyers ask for — attestation de régularité fiscale, attestation de
 * vigilance URSSAF, extrait Kbis, insurance certificates — plus the bilans
 * (annual and intermediate). The required papers form a checklist with their
 * validity; bilans are listed by year. Files go to the company documents
 * folder set in Settings → Google Drive contracts.
 */
export function CompanyAdmin() {
  const [folder, setFolder] = useState<{ name: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getSessionToken();
      if (!token) return;
      const response = await fetch("/api/google-drive", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const status = (await response.json()) as { configured?: boolean; companyRootFolderName?: string | null };
      if (!cancelled) setFolder({ name: status.configured ? status.companyRootFolderName || null : null });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeading title="Company documents">
        Attestations, Kbis, insurance and bilans, ready to send to a client or a tender. Renew a paper before it expires; the
        previous version stays in the history.
      </PageHeading>
      {folder && !folder.name && (
        <Alert>
          <AlertTitle>No company folder yet</AlertTitle>
          <AlertDescription>
            Set the company documents folder in <Link to="/settings/drive">Settings → Google Drive contracts</Link> before
            uploading.
          </AlertDescription>
        </Alert>
      )}
      <DocumentsPanel owner={COMPANY_OWNER} title="" requirements={["company"]} sectionFolders={["bilans"]} />
    </div>
  );
}
