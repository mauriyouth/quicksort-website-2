import { z } from "zod";

// Candidate intake parsing — shared by the /api/parse-candidate route and the
// Candidates drop zone. Extracts contact details and a profile sketch from a
// dropped resume (PDF), pasted CV text, or a LinkedIn profile (URL + pasted
// sections). Advisory only: a human reviews the prefilled form before insert.

export const MAX_INTAKE_PDF_BYTES = 3 * 1024 * 1024;
export const MAX_INTAKE_TEXT_CHARS = 60000;

const base64Pdf = z
  .string()
  .min(8)
  .max(MAX_INTAKE_PDF_BYTES * 4 / 3)
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
      z.object({ kind: z.literal("text"), text: z.string().trim().min(50).max(MAX_INTAKE_TEXT_CHARS) }),
      z.object({
        kind: z.literal("linkedin"),
        url: linkedInUrl,
        text: z.string().trim().min(50).max(MAX_INTAKE_TEXT_CHARS),
      }),
    ]),
  })
  .strict();

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
  summary: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

export type IntakeRequest = z.infer<typeof intakeRequest>;
export type ParsedProfile = z.infer<typeof parsedProfileSchema>;

export const INTAKE_SYSTEM_INSTRUCTIONS =
  "You extract candidate profiles for a recruiting CRM. Read the attached resume PDF or the pasted profile text and return only the structured profile. Rules: transcribe names, emails and phone numbers exactly as written; never invent contact details you cannot see; keep the LinkedIn URL only when it literally appears in the source; yearsExperience is total professional experience in years, null when not determinable; skills holds at most 40 concrete skills, tools, technologies or certifications; summary is a neutral 3-5 sentence professional sketch with no opinions, scores or recommendations; confidence reflects how complete and readable the source was.";
