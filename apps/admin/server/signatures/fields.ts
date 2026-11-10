import type { SupabaseClient } from "@supabase/supabase-js";

export type PersonFacts = {
  fullName: string;
  email: string;
  role: string;
  contractType: string | null;
  salaryMonthly: number | null;
  dailyRate: number | null;
  startDate: string | null;
  probationEnd: string | null;
  matricule: string | null;
};

const FIELD = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Unique placeholder names in order of first appearance. */
export function extractFields(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(FIELD)) if (!seen.includes(match[1])) seen.push(match[1]);
  return seen;
}

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const money = (value: number | null) => (value === null || !Number.isFinite(value) ? "" : euro.format(value));
const date = (iso: string | null) => {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
};

export function knownValues(facts: PersonFacts, today: string, signatoryName: string): Record<string, string> {
  const full = facts.fullName.trim();
  const space = full.indexOf(" ");
  return {
    prenom: space < 0 ? full : full.slice(0, space),
    nom: space < 0 ? "" : full.slice(space + 1).trim(),
    nom_complet: full,
    email: facts.email,
    poste: facts.role,
    type_contrat: facts.contractType ?? "",
    salaire_brut_mensuel: money(facts.salaryMonthly),
    tjm: money(facts.dailyRate),
    date_debut: date(facts.startDate),
    fin_periode_essai: date(facts.probationEnd),
    matricule: facts.matricule ?? "",
    date_du_jour: date(today),
    signataire_quicksort: signatoryName,
  };
}

export function missingFields(fields: string[], values: Record<string, string>): string[] {
  return fields.filter((name) => !(values[name] ?? "").trim());
}

const num = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

type OfferFacts = { role: string; contractType: string; salaryMonthly: number | null; dailyRate: number | null };

/** The newest accepted offer on these applications, or null. */
async function latestAcceptedOffer(client: SupabaseClient, applicationIds: string[]): Promise<OfferFacts | null> {
  if (!applicationIds.length) return null;
  const { data: offers, error } = await client
    .from("offers").select("title,contract_type,salary_monthly,cjm,created_at")
    .in("application_id", applicationIds).eq("status", "accepted").order("created_at", { ascending: false });
  if (error) throw error;
  const offer = (offers || [])[0];
  if (!offer) return null;
  const freelance = offer.contract_type === "Freelance";
  return {
    role: offer.title || "",
    contractType: offer.contract_type,
    salaryMonthly: freelance ? null : num(offer.salary_monthly),
    dailyRate: freelance ? num(offer.cjm) : null,
  };
}

/** Facts for a hire from an offer: employment-specific facts stay empty. */
function offerPersonFacts(person: { full_name: string; email: string | null }, offer: OfferFacts | null): PersonFacts {
  return {
    fullName: person.full_name,
    email: person.email || "",
    role: offer?.role ?? "",
    contractType: offer?.contractType ?? null,
    salaryMonthly: offer?.salaryMonthly ?? null,
    dailyRate: offer?.dailyRate ?? null,
    startDate: null,
    probationEnd: null,
    matricule: null,
  };
}

/**
 * Prefill facts for a person. With an application, they come from that
 * application's accepted offer, so a rehire never reuses the previous
 * employment. Without one: the open employment, else the newest accepted
 * offer, else the latest ended employment.
 */
export async function loadPersonFacts(client: SupabaseClient, personId: string, applicationId?: string): Promise<PersonFacts> {
  const { data: person, error: personError } = await client
    .from("hr_people").select("full_name,email").eq("id", personId).maybeSingle();
  if (personError) throw personError;
  if (!person) throw new Error("Person not found.");
  if (applicationId) return offerPersonFacts(person, await latestAcceptedOffer(client, [applicationId]));

  const { data: rows, error: empError } = await client
    .from("employees")
    .select("id,role,start_date,status,probation_end,offer_id,matricule")
    .eq("person_id", personId)
    .order("start_date", { ascending: false });
  if (empError) throw empError;
  const open = (rows || []).find((row: { status: string }) => row.status !== "ended") || null;

  // No open employment (a candidate, or someone being rehired): use the latest accepted offer.
  if (!open) {
    const { data: apps, error: appError } = await client.from("hr_applications").select("id").eq("person_id", personId);
    if (appError) throw appError;
    const offer = await latestAcceptedOffer(client, (apps || []).map((row: { id: string }) => row.id));
    if (offer) return offerPersonFacts(person, offer);
  }
  const employee = open || (rows || [])[0] || null;

  const today = new Date().toISOString().slice(0, 10);
  let salary: { rate_kind?: string; salary_monthly?: unknown; daily_rate?: unknown } | null = null;
  let contractType: string | null = null;
  if (employee) {
    const { data: salaries, error: salaryError } = await client
      .from("employee_salaries")
      .select("rate_kind,salary_monthly,daily_rate,start_date,end_date")
      .eq("employee_id", employee.id)
      .order("start_date", { ascending: false });
    if (salaryError) throw salaryError;
    salary = (salaries || []).find((row: { start_date: string; end_date: string | null }) =>
      row.start_date <= today && (!row.end_date || row.end_date >= today)) || null;
    if (employee.offer_id) {
      const { data: offer, error: offerError } = await client
        .from("offers").select("contract_type").eq("id", employee.offer_id).maybeSingle();
      if (offerError) throw offerError;
      contractType = offer?.contract_type ?? null;
    }
  }
  const daily = salary?.rate_kind === "daily";
  return {
    fullName: person.full_name,
    email: person.email || "",
    role: employee?.role || "",
    contractType,
    salaryMonthly: salary && !daily ? num(salary.salary_monthly) : null,
    dailyRate: salary && daily ? num(salary.daily_rate) : null,
    startDate: employee?.start_date ?? null,
    probationEnd: employee?.probation_end ?? null,
    matricule: employee?.matricule ?? null,
  };
}
