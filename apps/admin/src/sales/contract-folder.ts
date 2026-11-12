import { getSessionToken } from "@quicksort/hr-db";

/**
 * Keeps a project's Drive contract folder in step with its status: archived
 * projects move to <contracts root>/archived/<end year>, restored ones back
 * to the root (apps/admin/server/google-drive.ts, action "archive-folder").
 */
export async function placeContractFolder(projectId: string, archived: boolean): Promise<{ moved: boolean }> {
  const token = await getSessionToken();
  if (!token) throw new Error("Sign in again to move the contract folder.");
  const response = await fetch("/api/google-drive", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "archive-folder", projectId, archived }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The Google Drive request failed.");
  return result;
}
