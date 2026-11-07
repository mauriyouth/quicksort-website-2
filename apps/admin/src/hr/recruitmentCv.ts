/**
 * Client for /api/recruitment-cv — files candidate CVs on Google Drive under
 * <CV folder>/<year>/<position>/ (see server/recruitment-cv.ts). Both calls are
 * best-effort: the HR record is already saved, so failures come back as a
 * warning string for the caller to show, never as a thrown error.
 */
export type CvPosition = { title: string; openedAt: string };
type GetToken = () => Promise<string | null | undefined>;

async function post(getToken: GetToken, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const token = await getToken();
    if (!token) return { ok: false, error: "your session expired" };
    const response = await fetch("/api/recruitment-cv", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return { ok: false, error: "the CV filing service is unavailable" };
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return { ok: false, error: typeof data.error === "string" ? data.error : `HTTP ${response.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "the network request failed" };
  }
}

/** Files the intake PDF (still in the candidate-documents bucket). Returns a warning, or "" on success. */
export async function fileCv(getToken: GetToken, input: { storagePath: string; personId: string; personName: string; position: CvPosition | null }) {
  const result = await post(getToken, { action: "file", ...input });
  return result.ok ? "" : `The person was saved, but the CV was not filed on Google Drive: ${result.error}`;
}

/** Copies the person's filed CV into the position folder. No CV on Drive is not a warning. */
export async function copyCv(getToken: GetToken, input: { personId: string; personName: string; position: CvPosition }) {
  const result = await post(getToken, { action: "copy", ...input });
  return result.ok ? "" : `The application was created, but the CV was not copied on Google Drive: ${result.error}`;
}
