import { z } from "zod";

// Candidate intake parsing — shared by the /api/parse-candidate route and the
// Candidates drop zone. Extracts contact details and a profile sketch from a
// dropped resume (PDF), pasted CV text, or a LinkedIn profile (URL + pasted
// sections). Advisory only: a human reviews the prefilled form before insert.

// PDFs larger than this must come through Supabase Storage (browser uploads
// directly to the bucket, so the Vercel 4.5 MB API body limit does not apply).
export const MAX_INTAKE_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_INTAKE_TEXT_CHARS = 60000;

// Inline base64 PDFs travel inside the JSON request body, which Vercel caps at
// 4.5 MB — that path stays at 3 MB even though storage-backed PDFs go to 10 MB.
const MAX_INLINE_INTAKE_PDF_BYTES = 3 * 1024 * 1024;

const base64Pdf = z
  .string()
  .min(8)
  .max(MAX_INLINE_INTAKE_PDF_BYTES * 4 / 3)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

const linkedInUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (value) =>
      value === "" ||
      /^https:\/\/([\w-]+\.)?linkedin\.com\/[\w\-/%.?=&]+/i.test(value),
    "Use a full https://linkedin.com/in/… profile URL, or leave it empty.",
  );

export const intakeRequest = z
  .object({
    profile: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("pdf"), data: base64Pdf, name: z.string().trim().min(1).max(250) }),
      z.object({ kind: z.literal("storage"), path: z.string().trim().min(1).max(500), name: z.string().trim().min(1).max(250) }),
      z.object({ kind: z.literal("text"), text: z.string().trim().min(50).max(MAX_INTAKE_TEXT_CHARS) }),
      // The person's newest CV filed on Google Drive (Applications → Import from resume).
      z.object({ kind: z.literal("drive"), personId: z.string().uuid() }),
      z.object({
        kind: z.literal("linkedin"),
        url: linkedInUrl,
        text: z.string().trim().min(50).max(MAX_INTAKE_TEXT_CHARS),
      }),
    ]),
  })
  .strict();

/**
 * One position on a person's record (hr_people.experience), parsed from the
 * CV or typed by HR. start/end are "YYYY-MM"; end "" means current position.
 * Every field is required (empty string allowed) so the model's structured
 * output and the stored value share one shape.
 */
export const experienceItemSchema = z.object({
  title: z.string().max(200),
  company: z.string().max(200),
  contract_type: z.string().max(80),
  start: z.string().max(7),
  end: z.string().max(7),
  location: z.string().max(200),
  summary: z.string().max(1200),
  skills: z.array(z.string().trim().min(1).max(80)).max(12),
});
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
export const MAX_EXPERIENCE_ITEMS = 30;

export const parsedProfileSchema = z.object({
  fullName: z.string().max(200),
  email: z.string().max(200),
  phone: z.string().max(40),
  headline: z.string().max(300),
  currentRole: z.string().max(200),
  company: z.string().max(200),
  location: z.string().max(200),
  linkedinUrl: z.string().max(300),
  yearsExperience: z.number().min(0).max(70).nullable(),
  skills: z.array(z.string().trim().min(1).max(80)).max(40),
  experience: z.array(experienceItemSchema).max(MAX_EXPERIENCE_ITEMS),
  summary: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

export type IntakeRequest = z.infer<typeof intakeRequest>;
export type ParsedProfile = z.infer<typeof parsedProfileSchema>;

export const INTAKE_SYSTEM_INSTRUCTIONS =
  "You extract candidate profiles for a recruiting CRM. Read the attached resume PDF or the pasted profile text and return only the structured profile. Rules: transcribe names, emails and phone numbers exactly as written; never invent contact details you cannot see; keep the LinkedIn URL only when it literally appears in the source; yearsExperience is total professional experience in years, null when not determinable; skills holds at most 40 concrete skills, tools, technologies or certifications; experience lists every position newest first, with start and end as YYYY-MM (end empty for the current position, month 01 when only the year is known), contract_type as written (e.g. CDI, Freelance, Internship) or empty, a 1-3 sentence factual summary of missions and outcomes, and at most 12 skills used in that position; summary is a neutral 3-5 sentence professional sketch with no opinions, scores or recommendations; confidence reflects how complete and readable the source was.";
