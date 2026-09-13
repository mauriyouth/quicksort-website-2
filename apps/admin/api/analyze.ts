import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { loadAiSettings } from "../server/ai-settings.ts";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { analysisRequest, evaluationSchema, MAX_CV_BYTES, CRITERIA } from "../src/analysis.ts";
import { DEFAULT_INSTRUCTIONS, SYSTEM_INSTRUCTIONS } from "../server/analysis-instructions.ts";

export const config = { maxDuration: 120 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

export function createAnalyzer(deps = { createClient, generateText, loadAiSettings }) {
return async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to analyze CVs." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ error: "The analyzer needs its portal connection configured." });
  try {
    // Supabase verifies the Clerk token and applies the existing RLS policies.
    // Never use a service-role key here or trust a role supplied by the browser.
    const client = deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
    const identity = await client.rpc("sync_clerk_profile");
    if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
    const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
    if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });
    const aiSettings = await deps.loadAiSettings(client);
    if (!aiSettings.apiKey) return res.status(503).json({ error: "Add an OpenAI API key in Settings → AI configuration." });
    const parsed = analysisRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a job and provide a PDF up to 3 MB or CV text between 50 and 60,000 characters." });
    const input = parsed.data;
    const evaluationId = input.requestId || randomUUID();
    const previous = await client.from("cv_evaluations").select("report").eq("id", evaluationId).maybeSingle();
    if (previous.error) return res.status(503).json({ error: "Analysis history storage is unavailable. Try again before starting a scan." });
    if (previous.data) return res.status(200).json(previous.data.report);
    const job = await client.from("jobs").select("id,title,description,department,employment_type,updated_at").eq("id", input.jobId).single();
    if (job.error || !job.data) return res.status(404).json({ error: "This job is no longer available. Refresh the job list." });
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== job.data.updated_at) return res.status(409).json({ error: "The job changed during this batch. Refresh the portal and start a new evaluation." });
    if (!job.data.description?.trim()) return res.status(422).json({ error: "Add a job description before analyzing candidates." });
    let cv = input.cv;
    if (cv.kind === "document") {
      const document = await client.from("candidate_documents").select("storage_path,name,size_bytes").eq("id", cv.id).single();
      if (document.error || !document.data) return res.status(404).json({ error: "Candidate document unavailable." });
      if (document.data.size_bytes > MAX_CV_BYTES || !document.data.name.toLowerCase().endsWith(".pdf")) return res.status(400).json({ error: "Choose a PDF up to 3 MB, or paste its CV text." });
      const download = await client.storage.from("candidate-documents").download(document.data.storage_path);
      if (download.error || !download.data) return res.status(404).json({ error: "Could not retrieve this CV." });
      if (download.data.size > MAX_CV_BYTES) return res.status(400).json({ error: "CV exceeds 3 MB." });
      cv = { kind: "pdf", data: Buffer.from(await download.data.arrayBuffer()).toString("base64"), name: document.data.name };
    }
    const pdf = cv.kind === "pdf" ? Buffer.from(cv.data, "base64") : null;
    if (pdf && (pdf.length > MAX_CV_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-")) return res.status(400).json({ error: "Upload a valid PDF up to 3 MB." });
    const instructions = process.env.CV_ANALYSIS_INSTRUCTIONS?.trim() || DEFAULT_INSTRUCTIONS;
    const model = aiSettings.model;
    const { output } = await deps.generateText({
      model: createOpenAI({ apiKey: aiSettings.apiKey })(model), instructions: SYSTEM_INSTRUCTIONS,
      output: Output.object({ schema: evaluationSchema }),
      messages: [{ role: "user", content: [
        { type: "text", text: JSON.stringify({ job: job.data, writingInstructions: instructions, cvText: cv.kind === "text" ? cv.text : "See attached CV." }) },
        ...(pdf ? [{ type: "file" as const, data: pdf, mediaType: "application/pdf" as const }] : []),
      ] }],
      maxOutputTokens: 6500, maxRetries: 1, abortSignal: AbortSignal.timeout(100000),
      providerOptions: { openai: { store: false } },
    });
    const evaluation = evaluationSchema.parse(output);
    if (new Set(evaluation.scorecards.map(s => s.criterion)).size !== CRITERIA.length) throw new Error("Incomplete scoring rubric");
    evaluation.scorecards.sort((a, b) => CRITERIA.indexOf(a.criterion) - CRITERIA.indexOf(b.criterion));
    const report = { job: { id: job.data.id, title: job.data.title, updated_at: job.data.updated_at }, evaluation, model, analyzedAt: new Date().toISOString() };
    const saved = await client.from("cv_evaluations").insert({
      id: evaluationId, created_by: identity.data, job_id: job.data.id,
      file_name: cv.kind === "pdf" ? cv.name : "Pasted CV",
      candidate_name: evaluation.candidateName, job_title: job.data.title,
      report, job_snapshot: job.data, source_cv: cv,
    });
    if (saved.error) {
      if (saved.error.code === "23505") {
        const existing = await client.from("cv_evaluations").select("report").eq("id", evaluationId).single();
        if (!existing.error && existing.data) return res.status(200).json(existing.data.report);
      }
      return res.status(503).json({ error: "The evaluation could not be saved. Retry this file; it has not been marked complete." });
    }
    return res.status(200).json(report);
  } catch {
    // Do not log CVs, prompts, tokens, or provider request/response bodies.
    return res.status(502).json({ error: "Analysis could not be completed. Try again or paste the CV text if the PDF could not be read." });
  }
}
}
export default createAnalyzer();
