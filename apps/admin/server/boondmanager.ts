import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptApiKey, encryptApiKey, settingsReady } from "./ai-settings.ts";

/**
 * BoondManager integration API. Follows the ai-settings pattern: the Clerk
 * token is forwarded to Supabase so the same RLS/admin policies apply, and
 * the Boond credentials are stored AES-256-GCM encrypted (server-side key)
 * in boondmanager_settings. The Boond REST API is called from here, never
 * from the browser (https://doc.boondmanager.com/api-externe/).
 *
 * GET    /api/boondmanager — connection status (configured, canSave).
 * PUT    /api/boondmanager — save credentials { username, password, instance }
 *        (portal owners only).
 * DELETE /api/boondmanager — remove the saved connection (portal owners only).
 * POST   /api/boondmanager — run an import { kind: "clients" | "employees" |
 *        "candidates" }. Clients land in sales_clients, employees and
 *        candidates in the shared HR people directory. Source keys make imports
 *        repeatable; resource employment periods require a source start date.
 *        If a tenant rejects the JSON search (422/403 — module not activated
 *        or missing API rights), the import falls back to the documented
 *        .csv export for that endpoint.
 */
type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

const SETTING_ID = "connection";
const PAGE_SIZE = 500;

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  // BoondManager tenant host, e.g. "ui.boondmanager.com" or "acme.boondmanager.com".
  instance: z.string().trim().max(120).regex(/^[a-z0-9.-]+$/).default("ui.boondmanager.com"),
});
const importSchema = z.object({ kind: z.enum(["clients", "employees", "candidates"]) });

type BoondCredentials = z.infer<typeof credentialsSchema>;

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

/**
 * CSV export header aliases per endpoint. When a tenant's JSON search is
 * rejected (module not activated / rights), boondAll falls back to the .csv
 * export documented at doc.boondmanager.com/api-externe, which follows the
 * grid columns. Headers are normalized (accents stripped, lowercased) before
 * matching, so both French UI exports and English API headers work.
 */
const CSV_ALIASES = {
  companies: {
    required: ["name"],
    map: {
      id: ["id", "reference", "reference interne", "ref"],
      name: ["name", "nom", "societe", "raison sociale"],
      town: ["town", "ville"],
      country: ["country", "pays"],
      website: ["website", "site web", "site internet", "site"],
      expertiseArea: ["expertisearea", "expertise area", "secteur", "secteur d'activite", "expertise"],
      informationComments: ["informationcomments", "information comments", "informations"],
    },
  },
  resources: {
    required: ["firstName", "lastName", "fullName", "reference"],
    map: {
      id: ["id", "reference interne", "ref"],
      firstName: ["firstname", "first name", "prenom"],
      lastName: ["lastname", "last name", "nom de famille"],
      fullName: ["fullname", "full name", "nom", "name", "ressource"],
      email1: ["email1", "e-mail 1", "email", "e-mail", "courriel", "mail"],
      phone1: ["phone1", "telephone", "tel", "portable", "mobile", "gsm", "phone"],
      title: ["title", "titre", "intitule du poste", "intitule de poste", "poste"],
      skills: ["skills", "competences"],
      reference: ["reference"],
      startDate: ["startdate", "start date", "date d entree", "date d’entrée", "date entree", "date d embauche"],
      endDate: ["enddate", "end date", "date de sortie", "date sortie"],
      state: ["state", "status", "etat", "statut"],
    },
  },
  candidates: {
    required: ["firstName", "lastName", "fullName"],
    map: {
      id: ["id", "reference", "ref"],
      firstName: ["firstname", "first name", "prenom"],
      lastName: ["lastname", "last name", "nom de famille"],
      fullName: ["fullname", "full name", "nom", "name", "candidat"],
      email1: ["email1", "e-mail 1", "email", "e-mail", "courriel", "mail"],
      phone1: ["phone1", "telephone", "tel", "portable", "mobile", "gsm", "phone"],
      title: ["title", "titre", "intitule du poste", "intitule de poste", "poste"],
      skills: ["skills", "competences"],
    },
  },
} as const;
type BoondEndpoint = keyof typeof CSV_ALIASES;
type BoondItem = { id?: string; attributes: Record<string, unknown> };

const csvHeaderKey = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Minimal CSV parser (quoted fields, embedded newlines, "" escapes), like the Boond UI exports. */
function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n"));
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolons >= commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Extracts the human-readable message from a Boond error body ({ errors: [{ code, detail }] }). */
async function boondErrorDetail(response: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: { code?: string; detail?: string | Record<string, string> }[] };
    return (body.errors || [])
      .map((e) => {
        const message = typeof e.detail === "string" ? e.detail : Object.values(e.detail || {})[0] || "";
        return [e.code, message].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join(" | ");
  } catch {
    return "";
  }
}

async function boondFetch(creds: BoondCredentials, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://${creds.instance}/api/${path}`, {
    headers: boondHeaders(creds),
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error("BoondManager rejected the credentials. Check the account, and make sure REST API access is allowed in Boond (settings → security).") as Error & { boondStatus?: number };
    error.boondStatus = response.status;
    throw error;
  }
  if (response.status === 404)
    throw new Error(
      `BoondManager answered 404 at https://${creds.instance}/api/. Check the instance host: it must be your own Boond tenant, e.g. "yourcompany.boondmanager.com" — the host in your browser's address bar when you use Boond.`,
    );
  if (!response.ok) {
    // 422s carry a structured body: { errors: [{ code, detail, source }] }.
    // Surface Boond's own explanation (module not activated, missing rights,
    // bad parameter) instead of a bare status code.
    const detail = await boondErrorDetail(response);
    const message = detail
      ? `BoondManager answered ${response.status} (${detail}).`
      : `BoondManager answered with status ${response.status}.`;
    const error = new Error(message) as Error & { boondStatus?: number };
    error.boondStatus = response.status;
    throw error;
  }
  return (await response.json()) as Record<string, unknown>;
}

const boondHeaders = (creds: BoondCredentials) => {
  const auth = Buffer.from(`${creds.username}:${creds.password}`, "utf8").toString("base64");
  // x-Debug-Boondmanager unlocks the detailed 422 error variants (rights,
  // module activation, ...) documented at doc.boondmanager.com/api-externe.
  return { Authorization: `Basic ${auth}`, Accept: "application/json", "x-Debug-Boondmanager": "true" };
};

/** Notes prefix: the #id when the JSON API provided one, a CSV marker otherwise. */
const boondNote = (kind: string, id: unknown) =>
  id ? `BoondManager ${kind} #${id}.` : `BoondManager ${kind} (CSV export).`;

/**
 * Fetches the documented .csv export of a search endpoint and maps the rows
 * onto JSON-shaped items, so the importers don't care which path was used.
 */
async function boondCsv(creds: BoondCredentials, endpoint: BoondEndpoint): Promise<BoondItem[]> {
  const response = await fetch(`https://${creds.instance}/api/${endpoint}.csv?encoding=UTF-8`, {
    headers: boondHeaders(creds),
  });
  if (!response.ok) {
    const detail = await boondErrorDetail(response);
    throw new Error(
      detail
        ? `The ${endpoint} CSV export was rejected too (${detail}).`
        : `BoondManager rejected the ${endpoint} CSV export with status ${response.status}.`,
    );
  }
  const table = parseCsv((await response.text()).replace(/^\uFEFF/, ""));
  if (table.length < 2) return [];
  const header = table.shift()!.map(csvHeaderKey);
  const aliases = CSV_ALIASES[endpoint];
  const indexOf = new Map<string, number>();
  for (const [attr, names] of Object.entries(aliases.map)) {
    const index = header.findIndex((h) => (names as readonly string[]).includes(h));
    if (index >= 0) indexOf.set(attr, index);
  }
  if (!aliases.required.some((attr) => indexOf.has(attr)))
    throw new Error(
      `The ${endpoint} CSV export has no recognizable column (got: ${header.slice(0, 15).join(", ")}). ` +
        "Adjust the columns in the Boond grid, then retry.",
    );
  // A "Nom" column next to a "Prénom" column holds the last name, not a full
  // name; remap it so firstName + lastName compose correctly.
  if ((endpoint === "candidates" || endpoint === "resources") && indexOf.has("firstName") && indexOf.has("fullName")) {
    indexOf.set("lastName", indexOf.get("fullName")!);
    indexOf.delete("fullName");
  }
  return table
    .map((row): BoondItem => {
      const attributes: Record<string, unknown> = {};
      for (const [attr, index] of indexOf) {
        const value = clip(row[index], 4000);
        if (value) attributes[attr] = value;
      }
      const id = attributes.id ? String(attributes.id) : undefined;
      return { id, attributes };
    })
    .filter((item) => Object.keys(item.attributes).length > 0);
}

/**
 * Walks every page of a Boond search endpoint and returns the raw items.
 * Tenants without the module (or without API rights) on an endpoint answer
 * 422/403 on the JSON search; the documented .csv export is not subject to
 * the same restrictions, so the import still works via the fallback.
 */
async function boondAll(creds: BoondCredentials, endpoint: BoondEndpoint): Promise<{ items: BoondItem[]; via: "json" | "csv" }> {
  try {
    const items: BoondItem[] = [];
    let page = 1;
    for (;;) {
      const body = await boondFetch(creds, `${endpoint}?page=${page}&maxResults=${PAGE_SIZE}`);
      const batch = Array.isArray(body.data) ? (body.data as BoondItem[]) : [];
      items.push(...batch);
      const meta = body.meta as { totals?: { rows?: number } } | undefined;
      const total = Number(meta?.totals?.rows ?? batch.length);
      if (!batch.length || batch.length < PAGE_SIZE || items.length >= total) break;
      page += 1;
      if (page > 200) throw new Error("BoondManager returned too many pages to import safely.");
    }
    return { items, via: "json" };
  } catch (e) {
    const status = (e as { boondStatus?: number } | null)?.boondStatus;
    if (status !== 422 && status !== 403) throw e;
    return { items: await boondCsv(creds, endpoint), via: "csv" };
  }
}

type Counts = { created: number; updated: number; skipped: number; total: number; via: "json" | "csv" };

/**
 * Runs tasks with bounded concurrency: a whole import is hundreds of upserts,
 * and doing them one-by-one exceeds the serverless time limit. Errors from a
 * task reject the pool, which the handler surfaces as a 502.
 */
async function runPool<T>(tasks: T[], concurrency: number, worker: (task: T) => Promise<void>) {
  let index = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (index < tasks.length) {
      const task = tasks[index];
      index += 1;
      await worker(task);
    }
  });
  await Promise.all(lanes);
}

async function importClients(client: SupabaseClient, creds: BoondCredentials): Promise<Counts> {
  const { items: companies, via } = await boondAll(creds, "companies");
  const existing = await client.from("sales_clients").select("id,name,tags");
  if (existing.error) throw existing.error;
  const byName = new Map(
    ((existing.data || []) as { id: string; name: string; tags: string[] }[]).map((c) => [normalize(c.name), c]),
  );
  const now = new Date().toISOString();
  let created = 0, updated = 0, skipped = 0;
  // Duplicated company names inside Boond would otherwise insert twice in a
  // single run; the seen set collapses them to one (the first occurrence).
  const seen = new Set<string>();
  await runPool(companies, 8, async (item) => {
    const a = (item.attributes || {}) as Record<string, unknown>;
    const name = clip(a.name, 200);
    const key = name ? normalize(name) : "";
    if (!key || seen.has(key)) { skipped += 1; return; }
    seen.add(key);
    const location = clip([a.town, a.country].filter(Boolean).join(", "), 200);
    const comments = clip(a.informationComments, 4000);
    const notes = [boondNote("company", item.id), comments].filter(Boolean).join("\n");
    const values = {
      location,
      website: clip(a.website, 300),
      industry: clip(a.expertiseArea, 200),
      notes,
      updated_at: now,
    };
    const prev = byName.get(key);
    if (prev) {
      const r = await client.from("sales_clients")
        .update({ ...values, tags: Array.from(new Set([...(prev.tags || []), "boondmanager"])) })
        .eq("id", prev.id);
      if (r.error) throw r.error;
      updated += 1;
    } else {
      const r = await client.from("sales_clients")
        .insert({ name, ...values, tags: ["boondmanager"] });
      if (r.error) throw r.error;
      created += 1;
    }
  });
  return { created, updated, skipped, total: companies.length, via };
}

const importResultSchema = z.object({ person_id: z.uuid(), created: z.boolean() });

function employmentDate(value: unknown): string | null {
  const text = clip(value, 30);
  const french = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  const date = french ? `${french[3]}-${french[2]}-${french[1]}` : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

async function importPeople(client: SupabaseClient, creds: BoondCredentials, endpoint: "resources" | "candidates"): Promise<Counts> {
  const { items, via } = await boondAll(creds, endpoint);
  let created = 0, updated = 0, skipped = 0;
  const seen = new Set<string>();
  await runPool(items, 8, async (item) => {
    const a = item.attributes;
    const fullName = clip(`${clip(a.firstName, 100)} ${clip(a.lastName, 100)}`.trim(), 200) || clip(a.fullName, 200) || clip(a.reference, 200);
    const email = clip(a.email1, 200);
    // A stable export ID is preferable. Email is a source key only, never an account claim.
    const sourceId = clip(a.reference || item.id, 200) || (email ? `email:${email.toLowerCase()}` : "");
    const externalId = `${endpoint}:${sourceId}`;
    if (!fullName || !sourceId || seen.has(externalId)) { skipped += 1; return; }
    seen.add(externalId);
    const startDate = employmentDate(a.startDate || a.entryDate || a.hiringDate);
    const endDate = employmentDate(a.endDate || a.exitDate);
    const departed = /alumni|ancien|sorti|inactive|offboarded|ended|departed/.test(normalize(clip(a.state || a.status, 100)));
    const notes = [boondNote(endpoint === "resources" ? "resource" : "candidate", item.id),
      endpoint === "resources" && !startDate ? "Employment not imported: the source does not include a valid start date. HR must review and record the employment period." : "",
      endpoint === "resources" && departed && !endDate ? "Employment not imported: this departed resource has no valid exit date. HR must review the historical period." : "",
    ].filter(Boolean).join("\n");
    const result = await client.rpc("hr_command", { command: {
      kind: "import_person", request_id: crypto.randomUUID(),
      external_source: `boondmanager:${creds.instance}`, external_id: externalId,
      full_name: fullName, email, phone: clip(a.phone1, 40), headline: clip(a.title, 300),
      skills: clip(a.skills, 2000), notes, source: "boondmanager",
      rationale: `Imported ${endpoint} source ${sourceId} from ${creds.instance}.`,
      ...(endpoint === "resources" && startDate && (!departed || endDate) ? { employment: {
        role: clip(a.title, 200) || "Imported resource", start_date: startDate, ...(endDate ? { end_date: endDate } : {}),
      } } : {}),
    } });
    if (result.error) throw result.error;
    const receipt = importResultSchema.parse(result.data);
    if (receipt.created) created += 1; else updated += 1;
  });
  return { created, updated, skipped, total: items.length, via };
}

export function createBoondManagerHandler(deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "PUT", "DELETE", "POST"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, PUT, DELETE, POST");
      return res.status(405).json({ error: "Method not allowed." });
    }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer "))
      return res.status(401).json({ error: "Sign in to manage imports." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin")
        return res.status(403).json({ error: "Admin access is required." });

      if (req.method === "GET") {
        const { data, error } = await client.from("boondmanager_settings").select("updated_at").eq("id", SETTING_ID).maybeSingle();
        // Existing installations work before the new migration is applied.
        if (error && !["42P01", "PGRST205"].includes(String(error.code || ""))) throw error;
        return res.status(200).json({ configured: Boolean(data), updatedAt: data?.updated_at || null, canSave: settingsReady() });
      }

      if (req.method === "PUT" || req.method === "DELETE") {
        const owner = await client.from("portal_owners").select("user_id").eq("user_id", identity.data).maybeSingle();
        if (owner.error || !owner.data)
          return res.status(403).json({ error: "Only portal owners can manage the BoondManager connection." });
      }

      if (req.method === "DELETE") {
        const result = await client.from("boondmanager_settings").delete().eq("id", SETTING_ID);
        if (result.error) throw result.error;
        return res.status(200).json({ saved: false });
      }

      if (req.method === "PUT") {
        if (!settingsReady())
          return res.status(503).json({ error: "Set AI_SETTINGS_ENCRYPTION_KEY on the server before saving credentials." });
        const parsed = credentialsSchema.safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: "Enter the BoondManager username, password and instance host." });
        const result = await client.from("boondmanager_settings").upsert(
          { id: SETTING_ID, encrypted_credentials: encryptApiKey(JSON.stringify(parsed.data)), updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
        if (result.error) throw result.error;
        return res.status(200).json({ saved: true });
      }

      const parsed = importSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Choose what to import: clients, employees or candidates." });
      const row = await client.from("boondmanager_settings").select("encrypted_credentials").eq("id", SETTING_ID).maybeSingle();
      if (row.error && !["42P01", "PGRST205"].includes(String(row.error.code || ""))) throw row.error;
      if (row.error || !row.data)
        return res.status(503).json({ error: "Connect your BoondManager account before running an import." });
      let creds: BoondCredentials;
      try {
        creds = credentialsSchema.parse(JSON.parse(decryptApiKey(row.data.encrypted_credentials)));
      } catch {
        return res.status(502).json({ error: "The saved BoondManager credentials could not be read. Save them again." });
      }
      const counts = parsed.data.kind === "clients"
        ? await importClients(client, creds)
        : parsed.data.kind === "employees"
          ? await importPeople(client, creds, "resources")
          : await importPeople(client, creds, "candidates");
      return res.status(200).json({ kind: parsed.data.kind, ...counts });
    } catch (e) {
      // Errors with a message but no PostgREST code are user-safe (Boond
      // auth failures, pagination guards); database errors stay generic.
      const err = e as { message?: string; code?: string } | null;
      if (err?.code && ["42P01", "PGRST205"].includes(String(err.code)))
        return res.status(503).json({ error: "The boondmanager_settings table is missing. Apply the 20261006090000_boondmanager_settings migration (supabase db push) and retry." });
      if (err?.message && !err.code) return res.status(502).json({ error: err.message });
      return res.status(502).json({ error: "The BoondManager request could not be completed. Please try again." });
    }
  };
}
