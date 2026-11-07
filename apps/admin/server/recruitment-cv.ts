import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_INTAKE_PDF_BYTES } from "../src/candidate-intake.ts";
import {
  FILE_FIELDS,
  driveApi,
  ensureChildFolder,
  loadDriveSettings,
  uploadFileContent,
  type DriveFile,
  type DriveSettings,
} from "./documents/storage/google-drive.ts";

/**
 * Candidate CV filing on Google Drive (hiring pipeline). CVs live under the
 * recruitment root set in Settings → Google Drive:
 *
 *   <root>/<year>/<position title>/<Candidate name>.pdf
 *   <root>/<year>/Candidatures spontanées/<Candidate name>.pdf
 *
 * The year is the year the position was opened (so one position's CVs stay
 * together), or the filing year for spontaneous applications. Each file is
 * tagged with the HR person id (Drive appProperties) so it can be found and
 * copied when the person is later linked to a position.
 *
 * POST /api/recruitment-cv (admin or HR):
 *   { action: "file", storagePath, fileName?, personId, personName, position? }
 *     Reads the intake PDF from the candidate-documents bucket (RLS applies,
 *     as for /api/parse-candidate) and uploads it to Drive.
 *   { action: "copy", personId, personName, position }
 *     Copies the person's latest filed CV into the position folder. No CV on
 *     Drive yet → { copied: false, reason: "no-cv" }.
 * position = { title, openedAt } — names come from the caller's workspace;
 * opportunities are admin-only under RLS, so HR cannot be checked here.
 */
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): Response | void };

export const SPONTANEOUS_FOLDER = "Candidatures spontanées";
const PERSON_KEY = "quicksortPersonId";

const name = z.string().trim().min(1).max(200);
const position = z.object({ title: name, openedAt: z.string().max(40) });
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("file"),
    storagePath: z.string().min(1).max(500).regex(/^[\w-]+\/[\w-]+\.pdf$/),
    personId: z.string().uuid(),
    personName: name,
    position: position.nullable().optional(),
  }),
  z.object({
    action: z.literal("copy"),
    personId: z.string().uuid(),
    personName: name,
    position,
  }),
]);

/** Drive accepts any name; strip separators and control characters so paths read cleanly. */
export const cleanName = (value: string) => value.replace(/[\u0000-\u001f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "Sans nom";

/** Year folder: the position's opening year, else the filing year. */
export function cvYear(openedAt: string | null | undefined, now = new Date()) {
  const year = openedAt ? new Date(openedAt).getFullYear() : NaN;
  return String(Number.isFinite(year) ? year : now.getFullYear());
}

/** "<Name>.pdf", then "<Name> – <date>.pdf", then "<Name> – <date> (2).pdf"… */
export function uniqueCvName(personName: string, taken: Set<string>, now = new Date()) {
  const base = cleanName(personName);
  const first = `${base}.pdf`;
  if (!taken.has(first)) return first;
  const dated = `${base} – ${now.toISOString().slice(0, 10)}`;
  if (!taken.has(`${dated}.pdf`)) return `${dated}.pdf`;
  for (let n = 2; ; n++) if (!taken.has(`${dated} (${n}).pdf`)) return `${dated} (${n}).pdf`;
}

async function folderNames(sa: DriveSettings, folderId: string) {
  const body = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
    query: { q: `'${folderId}' in parents and trashed=false`, fields: "files(name)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" },
  });
  return new Set((body.files || []).map(file => file.name));
}

async function targetFolder(sa: DriveSettings, rootId: string, pos: { title: string; openedAt: string } | null | undefined) {
  const year = await ensureChildFolder(sa, rootId, cvYear(pos?.openedAt));
  return ensureChildFolder(sa, year.id, pos ? cleanName(pos.title) : SPONTANEOUS_FOLDER);
}

export function createRecruitmentCvHandler(deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Use POST." });
    }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer "))
      return res.status(401).json({ error: "Sign in to file candidate CVs." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || !["admin", "hr"].includes(role.data?.role || ""))
        return res.status(403).json({ error: "HR access is required." });
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Unknown CV filing request." });
      const action = parsed.data;

      const sa = await loadDriveSettings(client);
      if (!sa?.recruitment_root_folder_id)
        return res.status(503).json({ error: "No candidate CVs folder is set. Add it in Settings → Google Drive.", code: "not-configured" });
      const rootId = sa.recruitment_root_folder_id;

      if (action.action === "file") {
        // RLS decides which bucket paths this user may read — same as their browser.
        const download = await client.storage.from("candidate-documents").download(action.storagePath);
        if (download.error || !download.data) return res.status(404).json({ error: "The uploaded CV is no longer available. Upload it again." });
        const data = Buffer.from(await download.data.arrayBuffer());
        if (data.length > MAX_INTAKE_PDF_BYTES || data.subarray(0, 5).toString() !== "%PDF-")
          return res.status(400).json({ error: "Only PDF CVs up to 10 MB can be filed." });
        const folder = await targetFolder(sa, rootId, action.position);
        const fileName = uniqueCvName(action.personName, await folderNames(sa, folder.id));
        const file = await uploadFileContent(sa, { name: fileName, mimeType: "application/pdf", data, appProperties: { [PERSON_KEY]: action.personId } }, folder.id);
        return res.status(200).json({ filed: true, file, folder });
      }

      // copy — the person's newest CV anywhere in the Shared Drive(s).
      const found = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
        query: {
          q: `appProperties has { key='${PERSON_KEY}' and value='${action.personId}' } and trashed=false`,
          fields: `files(${FILE_FIELDS})`,
          orderBy: "createdTime desc",
          pageSize: "20",
          corpora: "allDrives",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        },
      });
      const files = found.files || [];
      if (!files.length) return res.status(200).json({ copied: false, reason: "no-cv" });
      const folder = await targetFolder(sa, rootId, action.position);
      const existing = files.find(file => file.parents?.includes(folder.id));
      if (existing) return res.status(200).json({ copied: false, reason: "already-filed", file: existing, folder });
      const fileName = uniqueCvName(action.personName, await folderNames(sa, folder.id));
      const file = await driveApi<DriveFile>(sa, `/files/${files[0].id}/copy`, {
        method: "POST",
        query: { fields: FILE_FIELDS, supportsAllDrives: "true" },
        body: { name: fileName, parents: [folder.id], appProperties: { [PERSON_KEY]: action.personId } },
      });
      return res.status(200).json({ copied: true, file, folder });
    } catch (e) {
      // Messages without a PostgREST code are user-safe Drive/auth errors.
      const err = e as { message?: string; code?: string } | null;
      if (err?.message && !err.code) return res.status(502).json({ error: err.message });
      return res.status(502).json({ error: "The CV could not be filed on Google Drive. Please try again." });
    }
  };
}
