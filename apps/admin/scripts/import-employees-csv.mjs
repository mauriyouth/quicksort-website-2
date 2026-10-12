#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

// Uses the same authenticated, audited command as the application import.
// SUPABASE_URL, SUPABASE_ANON_KEY, HR_IMPORT_ACCESS_TOKEN (an administrator session for historical employment).
// node apps/admin/scripts/import-employees-csv.mjs <csv-path> [--dry-run]
const clip = (value, max) => String(value ?? "").trim().slice(0, max);

// Minimal RFC-4180-style parser: delimiter, double-quote quoting, "" escapes,
// CRLF/LF inside quoted fields, BOM on the first header cell.
export function parseCsv(text, delimiter = ";") {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("The CSV ends inside a quoted field.");
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  if (rows.length) rows[0][0] = rows[0][0].replace(/^﻿/, "");
  return rows;
}

export const toDate = (value) => {
  const raw = value.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
};

export async function importCsv(csvPath, dryRun) {
// ---------- parse + map ----------
const table = parseCsv(readFileSync(csvPath, "utf8"));
const [header, ...lines] = table;
if (!header?.includes("Référence interne")) throw new Error("The CSV must contain a Référence interne column for stable source identity.");
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const get = (row, name) => row[col[name]]?.trim() ?? "";

const people = lines.map((row) => {
  const fullName = clip(`${get(row, "Prénom")} ${get(row, "Nom")}`.trim(), 200) || clip(get(row, "Référence interne"), 200);
  const email = clip(get(row, "Email 1"), 200);
  const title = clip(get(row, "Titre"), 200);
  const state = clip(get(row, "État"), 100);
  const startDate = toDate(get(row, "Date de démarrage"));
  const endDate = toDate(get(row, "Date de sortie") || get(row, "Date de fin"));
  const ended = /sorti|ancien|alumni|inactif/i.test(state);
  const canImportEmployment = Boolean(startDate && (!ended || endDate));
  const notes = [
    !canImportEmployment ? "Employment not imported: source dates/status need HR review before recording an employment period." : "",
    `BoondManager resource ${get(row, "Référence interne")} (imported from CSV).`,
    title ? `Title: ${title}` : "",
    get(row, "Matricule") ? `Matricule: ${get(row, "Matricule")}` : "",
    get(row, "Type") ? `Type: ${get(row, "Type")}` : "",
    state ? `État: ${state}` : "",
    get(row, "Grade") ? `Grade: ${get(row, "Grade")}` : "",
    [get(row, "Responsable manager"), get(row, "Responsable RH")].filter(Boolean).length
      ? `Managers: ${[get(row, "Responsable manager"), get(row, "Responsable RH")].filter(Boolean).join(" / ")}`
      : "",
    get(row, "Agence") ? `Agence: ${get(row, "Agence")}` : "",
    get(row, "Mobilité") ? `Mobilité: ${get(row, "Mobilité")}` : "",
    get(row, "Tarif HT") && get(row, "Tarif HT") !== "0,00" ? `Tarif HT: ${get(row, "Tarif HT")} ${get(row, "Devise")}` : "",
    get(row, "Disponibilité") && get(row, "Disponibilité") !== "-" ? `Disponibilité: ${get(row, "Disponibilité")}` : "",
    get(row, "Commentaires (informations)") ? `Comments: ${get(row, "Commentaires (informations)")}` : "",
    get(row, "Langues") ? `Langues: ${get(row, "Langues")}` : "",
    get(row, "Diplômes") ? `Diplômes: ${get(row, "Diplômes")}` : "",
  ].filter(Boolean).join("\n");
  return {
    externalId: clip(get(row, "Référence interne"), 200),
    fullName,
    email,
    phone: clip(get(row, "Téléphone 1").replace(/[\s.-]/g, ""), 40),
    skills: clip(get(row, "Compétences").replace(/\n{2,}/g, "\n"), 2000),
    notes: clip(notes, 5000),
    startDate: canImportEmployment ? startDate : null,
    endDate,
    title,
  };
}).filter((p) => p.fullName);


  if (people.some(p => !p.externalId)) throw new Error("Every row requires a stable Référence interne. Name matching is not an identity key.");
  console.log(`Parsed ${people.length} resources. Stable source identity from Référence interne.`);
  if (dryRun) { console.log("Dry run complete; no database requests."); return; }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const token = process.env.HR_IMPORT_ACCESS_TOKEN;
  const instance = process.env.HR_IMPORT_BOOND_INSTANCE;
  if (!instance || !/^[a-z0-9.-]+$/.test(instance)) throw new Error("Set HR_IMPORT_BOOND_INSTANCE to the same tenant host used by the application import.");
  if (!url || !key || !token) throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and HR_IMPORT_ACCESS_TOKEN to an authorized administrator session for historical employment.");
  for (const p of people) {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/hr_command`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: {
        kind: "import_person", request_id: randomUUID(), external_source: `boondmanager:${instance}`, external_id: `resources:${p.externalId}`,
        full_name: p.fullName, email: p.email, phone: p.phone, skills: p.skills, notes: p.notes, headline: p.title,
        source: "BoondManager CSV", rationale: "Historical resource import from BoondManager CSV",
        ...(p.startDate ? { employment: { role: p.title || "Consultant", start_date: p.startDate, ...(p.endDate ? { end_date: p.endDate } : {}) } } : {}),
      } }),
    });
    if (!response.ok) throw new Error(`Import failed for source ${p.externalId}: ${(await response.text()).slice(0, 1000)}`);
    await response.json();
  }
  console.log(`Imported ${people.length} resources. Existing stable source IDs are updated without duplicate employment periods.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2];
  if (!path || path.startsWith("--")) { console.error("Usage: import-employees-csv.mjs <csv-path> [--dry-run]"); process.exitCode = 1; }
  else await importCsv(resolve(path), process.argv.includes("--dry-run"));
}
