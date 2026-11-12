import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Archived contracts live under <contracts root>/archived/<year>, the year of
 * the contract's end (else the current year). Used when a project is archived
 * (google-drive.ts, action "archive-folder") and when an archived project gets
 * its first document (documents/handler.ts).
 */
export const ARCHIVE_FOLDER_NAME = "archived";

export function archiveYear(endDate: string | null | undefined, today = new Date()): string {
  return /^\d{4}/.exec(endDate || "")?.[0] || String(today.getFullYear());
}

/** Built-in project statuses (referentials.ts) when admin_statuses has none. */
const BUILTIN_TERMINAL = new Set(["archive"]);

/** ["archived", "<year>"] for an archived project, [] otherwise. */
export async function archivedProjectPrefix(client: SupabaseClient, projectId: string): Promise<string[]> {
  const { data: project } = await client.from("sales_projects").select("status,end_date").eq("id", projectId).maybeSingle();
  const row = project as { status?: string | null; end_date?: string | null } | null;
  if (!row?.status) return [];
  const { data: statuses } = await client.from("admin_statuses").select("key,is_terminal").eq("kind", "project");
  const saved = (statuses ?? []) as { key: string; is_terminal: boolean }[];
  const terminal = saved.length ? saved.some((s) => s.key === row.status && s.is_terminal) : BUILTIN_TERMINAL.has(row.status);
  return terminal ? [ARCHIVE_FOLDER_NAME, archiveYear(row.end_date)] : [];
}
