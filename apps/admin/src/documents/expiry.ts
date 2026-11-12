import type { DocumentRecord, DocumentTypeRecord } from "@quicksort/hr-db";

/** Today in Paris, like the document_alerts view. */
export const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

export type ExpiryState = { tone: "expired" | "expiring" | "valid" | "none"; daysLeft: number | null };

/** Same thresholds as the view: expired before today, expiring inside the largest warn window. */
export function expiryState(doc: Pick<DocumentRecord, "expires_on">, type: Pick<DocumentTypeRecord, "warn_days"> | undefined, today = parisToday()): ExpiryState {
  if (!doc.expires_on) return { tone: "none", daysLeft: null };
  const daysLeft = dayNumber(doc.expires_on) - dayNumber(today);
  if (daysLeft < 0) return { tone: "expired", daysLeft };
  const window = Math.max(-1, ...(type?.warn_days || []));
  return { tone: daysLeft <= window ? "expiring" : "valid", daysLeft };
}

export function expiryLabel(state: ExpiryState) {
  if (state.daysLeft === null) return "";
  if (state.tone === "expired") return state.daysLeft === -1 ? "Expired yesterday" : `Expired ${-state.daysLeft} days ago`;
  if (state.daysLeft === 0) return "Expires today";
  return state.daysLeft === 1 ? "Expires tomorrow" : `Expires in ${state.daysLeft} days`;
}

/** The registry fields behind an employee upload's status (public.my_documents). */
export type UploadRegistryRow = { status: "active" | "superseded" | "archived"; needs_review: boolean; expires_on: string | null; warn_days: number[] };

/**
 * The admin checklist pill for an employee's own upload: same labels and
 * tones, so the portal and HR read the same status. No registry row means HR
 * has not linked the account yet (or it is a CV, kept with the application).
 */
export function uploadStatus(
  registry: UploadRegistryRow | undefined,
  category: string,
  today = parisToday(),
): { label: string; tone: "filed" | "expiring" | "expired" | "missing" } {
  if (!registry) return { label: category === "resume" ? "With your application" : "Received", tone: "missing" };
  if (registry.status === "superseded") return { label: "Replaced", tone: "missing" };
  if (registry.status === "archived") return { label: "Archived", tone: "missing" };
  if (registry.needs_review) return { label: "To classify", tone: "missing" };
  const expiry = expiryState(registry, registry, today);
  if (expiry.tone === "expired" || expiry.tone === "expiring") return { label: expiryLabel(expiry), tone: expiry.tone };
  return { label: "Verified", tone: "filed" };
}
