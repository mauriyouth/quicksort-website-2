import { z } from "zod";
import { MAX_EXPERIENCE_ITEMS, parsedProfileSchema, type ParsedProfile } from "../src/candidate-intake.ts";

const ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";

/** Kimi failures carry the HTTP status so the route can explain them; never the key or the CV. */
export class KimiError extends Error {
  readonly status?: number;
  /** Field paths that failed validation, safe to log (no CV content). */
  readonly issues: string;
  constructor(message: string, status?: number, issues = "") {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

/*
 * The structure Kimi fills, laid out like a resume. Moonshot enforces it
 * (Structured Output, strict). Kept deliberately simple — flat objects, no
 * $ref / anyOf / length limits — because kimi-k2.6 is unstable on complex
 * schemas. Lengths, date formats and caps are applied afterwards by
 * toProfile(), which maps this onto the app's ParsedProfile.
 */
const str = (description: string) => ({ type: "string", description });
const list = (items: object, description: string) => ({ type: "array", description, items });
const object = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

export const RESUME_JSON_SCHEMA = object({
  full_name: str("Name exactly as written."),
  headline: str("Job title or tagline under the name, or empty."),
  email: str("Email as written, or empty. Never invent."),
  phone: str("Phone as written, or empty. Never invent."),
  location: str("City / country of the candidate, or empty."),
  linkedin_url: str("LinkedIn URL only if literally written, else empty."),
  profile: str("The introduction paragraph of the CV (Profil / Profile / Summary / About me / Objectif), copied word for word. If the CV has none, a neutral 3-5 sentence professional sketch. Never empty."),
  years_experience: { type: ["number", "null"], description: "Total professional experience in years, null when not determinable." },
  experience: list(object({
    title: str("Job title."),
    company: str("Employer or client."),
    contract_type: str("As written (CDI, Freelance, Internship…) or empty."),
    location: str("City / country, or empty."),
    start: str("Start as YYYY-MM (YYYY-01 when only the year is known)."),
    end: str("End as YYYY-MM, or empty when current."),
    current: { type: "boolean", description: "True when the candidate still holds this position." },
    description: str("2-5 factual sentences: role, missions, projects and measurable outcomes, from the CV."),
    skills: list({ type: "string" }, "Up to 12 skills or tools used in this position."),
  }), "Every position, newest first."),
  education: list(object({
    degree: str("Degree, diploma or training (with the field of study)."),
    school: str("School or university."),
    start_year: str("First year of the studies as YYYY, or empty."),
    end_year: str("Graduation or last year as YYYY (the only year when just one is shown), or empty."),
  }), "Every degree or training, newest first."),
  certifications: list(object({
    name: str("Certification name."),
    issuer: str("Issuing organisation, or empty."),
    year: str("Year obtained as YYYY, or empty."),
  }), "Every professional certification."),
  languages: list(object({
    language: str("Spoken language."),
    level: str("Level as written (C1, Native, Fluent…), or empty."),
  }), "Every spoken language."),
  skills: list({ type: "string" }, "Up to 40 concrete skills, tools, technologies and certifications."),
  confidence: { type: "string", enum: ["low", "medium", "high"], description: "How complete and readable the source was." },
});

/* ---------- Lenient mapping onto ParsedProfile ---------- */

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "").slice(0, max);
const paragraph = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "").slice(0, max);
const items = (value: unknown, max: number) => (Array.isArray(value) ? value.filter(item => item && typeof item === "object").slice(0, max) : []) as Record<string, unknown>[];
const words = (value: unknown, max: number) => [...new Set((Array.isArray(value) ? value : []).map(item => text(item, 80)).filter(Boolean))].slice(0, max);

const yearsIn = (value: unknown) => (typeof value === "string" ? value : String(value ?? "")).match(/\b(19|20)\d{2}\b/g) ?? [];
/** Last 4-digit year in the value ("2015 – 2017" → "2017"), else "". */
const year = (value: unknown) => yearsIn(value).at(-1) ?? "";
/** Start and end year of a degree, tolerating a whole range in either field ("2013 – 2015"). */
function studyYears(item: Record<string, unknown>) {
  const all = [...yearsIn(item.start_year), ...yearsIn(item.end_year), ...yearsIn(item.year)].sort();
  if (!all.length) return { start_year: "", end_year: "" };
  const end = all.at(-1)!, start = all[0];
  return { start_year: start === end ? "" : start, end_year: end };
}
/** "2020-03", "03/2020", "2020/3", "mars 2020", "2020" → "YYYY-MM"; "Present", "Aujourd'hui", "" → "". */
const MONTHS = ["jan", "f[eé]v|feb", "mar", "a[vp]r", "ma[iy]", "jui?n|jun", "jui?l|jul", "ao[uû]|aug", "sep", "oct", "nov", "d[eé]c|dec"];
function month(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const y = raw.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!y) return "";
  let m = raw.match(/\b(19|20)\d{2}[-/.](\d{1,2})\b/)?.[2] ?? raw.match(/\b(\d{1,2})[-/.](19|20)\d{2}\b/)?.[1];
  if (!m) {
    const index = MONTHS.findIndex(pattern => new RegExp(`\\b(${pattern})`).test(raw));
    if (index >= 0) m = String(index + 1);
  }
  const n = Number(m);
  return `${y}-${String(n >= 1 && n <= 12 ? n : 1).padStart(2, "0")}`;
}

/** Maps Kimi's resume-shaped answer onto ParsedProfile, trimming instead of rejecting. */
export function toProfile(raw: unknown): ParsedProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const yearsExperience = typeof r.years_experience === "number" && Number.isFinite(r.years_experience) ? Math.min(70, Math.max(0, Math.round(r.years_experience * 10) / 10)) : null;
  const experience = items(r.experience, MAX_EXPERIENCE_ITEMS).map(item => {
    const start = month(item.start);
    const end = item.current === true ? "" : month(item.end);
    return {
      title: text(item.title, 200),
      company: text(item.company, 200),
      contract_type: text(item.contract_type, 80),
      start,
      end: end && start && end < start ? "" : end,
      location: text(item.location, 200),
      summary: paragraph(item.description ?? item.summary, 1200),
      skills: words(item.skills, 12),
    };
  }).filter(item => item.title || item.company);
  const current = experience.find(item => !item.end) ?? experience[0];
  return parsedProfileSchema.parse({
    fullName: text(r.full_name, 200),
    email: text(r.email, 200),
    phone: text(r.phone, 40),
    headline: text(r.headline, 300),
    currentRole: current?.title ?? "",
    company: current?.company ?? "",
    location: text(r.location, 200),
    linkedinUrl: text(r.linkedin_url, 300),
    yearsExperience,
    skills: words(r.skills, 40),
    experience,
    education: items(r.education, 15).map(item => ({ degree: text(item.degree, 200), school: text(item.school, 200), ...studyYears(item) })).filter(item => item.degree || item.school),
    certifications: items(r.certifications, 30).map(item => ({ name: text(item.name, 200), issuer: text(item.issuer, 200), year: year(item.year) })).filter(item => item.name),
    languages: items(r.languages, 15).map(item => ({ language: text(item.language, 80), level: text(item.level, 80) })).filter(item => item.language),
    summary: paragraph(r.profile ?? r.summary, 3000),
    confidence: ["low", "medium", "high"].includes(r.confidence as string) ? r.confidence : "medium",
  });
}

/** JSON from the answer, tolerating a ```json fence (seen on kimi-k2.6). */
function json(content: unknown) {
  if (typeof content !== "string") throw new Error("no content");
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : content).trim());
}

// Written against the "resume" structure's own field names (not the app's),
// so the model is never told about a field it cannot see.
const SYSTEM = [
  "You extract candidate resumes for a recruiting CRM. Fill the \"resume\" structure from the CV text. Transcribe; never invent. Use an empty string or empty list only when the CV truly has nothing for a field.",
  "full_name, email, phone: exactly as written; never invent contact details. linkedin_url: only if literally written.",
  "profile: REQUIRED when the CV has an introduction. Copy, word for word and in the CV's language, the paragraph under a heading such as Profil, Profile, Summary, About me, À propos, Résumé, Objective or Objectif — or the introductory paragraph under the name and title when there is no heading. Only when the CV has no such paragraph, write a neutral 3-5 sentence professional sketch (no opinions, scores or recommendations).",
  "experience: every position, newest first. start/end as YYYY-MM (YYYY-01 when only the year is known); current=true and end empty for a position held today (\"aujourd'hui\", \"present\", \"en cours\"). contract_type as written (CDI, CDD, Freelance, Stage/Internship…) or empty. description: 2-5 factual sentences on the role, missions, projects and measurable outcomes, taken from the CV. skills: at most 12 used in that position.",
  "education: every degree, diploma or training, newest first, with start_year and end_year: \"2016 – 2018\" gives 2016 and 2018; when only one year is shown, put it in end_year and leave start_year empty.",
  "certifications: every professional certification with its issuer and year when shown. languages: every spoken language with its level as written.",
  "skills: at most 40 concrete skills, tools, technologies or certifications. years_experience: total professional years, null when unclear. confidence: how complete and readable the CV text was.",
].join("\n");
const RETRY_MIN_MS = 20_000;

/**
 * Extracts a candidate profile from resume text with Kimi (Moonshot)
 * Structured Output. `deadline` is an absolute time (ms) by which the whole
 * extraction must end; a malformed answer is retried once if time allows.
 */
export async function kimiProfile(
  cfg: { apiKey: string; model: string },
  prompt: string,
  deadline: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProfile> {
  let issues = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt && deadline - Date.now() < RETRY_MIN_MS) break;
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        // No temperature: current Kimi models only accept their default.
        // Reasoning off: a long CV with it does not fit the function budget.
        thinking: { type: "disabled" },
        response_format: { type: "json_schema", json_schema: { name: "resume", strict: true, schema: RESUME_JSON_SCHEMA } },
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (!res.ok) throw new KimiError(`Moonshot request failed (HTTP ${res.status}).`, res.status);
    const body = await res.json().catch(() => null) as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] } | null;
    const choice = body?.choices?.[0];
    try {
      const profile = toProfile(json(choice?.message?.content));
      if (!profile.fullName && !profile.experience.length && !profile.education.length && !profile.summary) throw new Error("empty");
      return profile;
    } catch (failure) {
      issues = choice?.finish_reason === "length" ? "answer cut off (max_tokens)"
        : failure instanceof Error && failure.message === "empty" ? "empty profile"
        : failure instanceof z.ZodError ? failure.issues.map(issue => issue.path.join(".")).slice(0, 10).join(", ")
        : `not JSON (finish_reason=${choice?.finish_reason ?? "none"})`;
    }
  }
  throw new KimiError("Kimi returned a profile that does not match the expected format.", undefined, issues);
}
