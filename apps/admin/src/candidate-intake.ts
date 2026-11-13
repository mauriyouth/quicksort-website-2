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

/** A degree or training from the CV. Years are "YYYY", "" when unknown (end_year alone for a single year). */
export const educationItemSchema = z.object({
  degree: z.string().max(200),
  school: z.string().max(200),
  start_year: z.string().max(4),
  end_year: z.string().max(4),
});
/** "2016", "2018" → "2016–2018"; one known year → that year. En dash, no spaces, so a stored line still splits on " — ". */
export const yearRange = (start: string, end: string) => start && end && start !== end ? `${start}–${end}` : end || start;
/** A certification from the CV. year is when it was obtained, "" when unknown. */
export const certificationItemSchema = z.object({
  name: z.string().max(200),
  issuer: z.string().max(200),
  year: z.string().max(4),
});
/** A spoken language and the level written in the CV (CEFR, "native", "fluent"…). */
export const languageItemSchema = z.object({
  language: z.string().max(80),
  level: z.string().max(80),
});

// hr_people stores education, certifications and languages as one entry per
// line, fields joined by " — " (the format the record page parses back).
const line = (...fields: string[]) => fields.map(field => field.trim()).filter(Boolean).join(" — ");
export const educationLines = (items: z.infer<typeof educationItemSchema>[]) => items.map(item => line(item.degree, item.school, yearRange(item.start_year, item.end_year))).filter(Boolean).join("\n");
export const certificationLines = (items: z.infer<typeof certificationItemSchema>[]) => items.map(item => line(item.name, item.issuer, item.year)).filter(Boolean).join("\n");
export const languageLines = (items: z.infer<typeof languageItemSchema>[]) => items.map(item => line(item.language, item.level)).filter(Boolean).join("\n");

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
  education: z.array(educationItemSchema).max(15),
  certifications: z.array(certificationItemSchema).max(30),
  languages: z.array(languageItemSchema).max(15),
  summary: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

export type IntakeRequest = z.infer<typeof intakeRequest>;
export type ParsedProfile = z.infer<typeof parsedProfileSchema>;

export const INTAKE_SYSTEM_INSTRUCTIONS =
  "You extract candidate profiles for a recruiting CRM. Read the attached resume PDF or the pasted profile text and return only the structured profile. Rules: transcribe names, emails and phone numbers exactly as written; never invent contact details you cannot see; keep the LinkedIn URL only when it literally appears in the source; yearsExperience is total professional experience in years, null when not determinable; skills holds at most 40 concrete skills, tools, technologies or certifications; experience lists every position newest first, with start and end as YYYY-MM (end empty for the current position, month 01 when only the year is known), contract_type as written (e.g. CDI, Freelance, Internship) or empty, a summary describing the role, its missions, projects and measurable outcomes in 2-5 factual sentences taken from the CV description, and at most 12 skills used in that position; education lists every degree, diploma or training newest first with the school, start_year and end_year as YYYY (a range such as 2016-2018 gives both; a single year goes in end_year with start_year empty; empty when unknown); certifications lists every professional certification with its issuer and year when shown (also keep them in skills); languages lists every spoken language with the level as written (e.g. C1, Native, Fluent) or empty; summary is the candidate's own profile, \"About me\" or objective paragraph transcribed as written in the CV (same language, at most 3000 characters); when the CV has no such paragraph, write a neutral 3-5 sentence professional sketch instead, with no opinions, scores or recommendations; confidence reflects how complete and readable the source was.";
