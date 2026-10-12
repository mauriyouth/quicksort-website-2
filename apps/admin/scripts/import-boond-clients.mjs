#!/usr/bin/env node
/**
 * One-off / repeatable importer for a BoondManager "sociétés" CSV export.
 *
 *   node scripts/import-boond-clients.mjs <file.csv> [--dry-run]
 *
 * Requires SUPABASE_SERVICE_KEY in the environment (get it with
 * `supabase projects api-keys --project-ref <ref>`); the public URL is read
 * from apps/admin/.env. Rows are matched on a normalized name so re-running
 * the import skips companies that already exist in sales_clients instead of
 * duplicating them (same rule as the /api/boondmanager import).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file) {
  console.error("Usage: node scripts/import-boond-clients.mjs <file.csv> [--dry-run]");
  process.exit(1);
}

// --- minimal ; -delimited CSV parser (quotes, embedded newlines, "" escapes)
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") { row.push(field); field = ""; }
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

const normalize = (value) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const filled = (row, keys) => keys.filter((k) => String(row[k] || "").trim()).length;

function parseBoondDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi] = match;
  // Export dates are Europe/Paris; every date in the file falls in DST (CEST, +02:00).
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00+02:00`).toISOString();
}

const table = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const header = table.shift();
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const get = (row, name) => row[col[name]] ?? "";

// --- map a CSV row to a sales_clients record
function toClient(row) {
  const name = clip(get(row, "Nom"), 200);
  if (!name) return null;
  const ref = clip(get(row, "Référence interne"), 40);
  const notesParts = [`BoondManager company ${ref || "sans référence"}.`];
  const info = String(get(row, "Informations") || "").trim();
  if (info) notesParts.push(info);
  const phone = clip(get(row, "Téléphone"), 40);
  if (phone) notesParts.push(`Téléphone: ${phone}`);
  const manager = clip(get(row, "Responsable manager"), 200);
  if (manager) notesParts.push(`Responsable: ${manager}`);
  const provenance = clip(
    [get(row, "Provenance - Type"), get(row, "Provenance - Détail")].filter(Boolean).join(" — "), 300);
  if (provenance) notesParts.push(`Provenance: ${provenance}`);
  const mere = clip(get(row, "Société mère - Nom"), 200);
  if (mere) notesParts.push(`Société mère: ${mere}`);

  const location = clip(
    [
      [get(row, "Code postal"), get(row, "Ville")].filter(Boolean).join(" "),
      get(row, "Pays"),
    ].filter(Boolean).join(", "), 200);

  const tags = ["boondmanager"];
  const etat = clip(get(row, "État"), 50);
  if (etat) tags.push(normalize(etat).replace(/\s+/g, "-"));
  const type = clip(get(row, "Provenance - Type"), 50);
  if (type) tags.push(normalize(type).replace(/\s+/g, "-"));

  return {
    name,
    industry: clip(get(row, "Secteur"), 200),
    website: clip(get(row, "Site web"), 300),
    location,
    tags: Array.from(new Set(tags)),
    notes: clip(notesParts.join("\n"), 5000),
    created_at: parseBoondDate(get(row, "Date de création")) || undefined,
    updated_at: parseBoondDate(get(row, "Date de mise à jour")) || undefined,
  };
}

// --- dedupe inside the file: keep the richest row per normalized name
const richnessKeys = ["Secteur", "Informations", "Site web", "Téléphone", "Ville", "État"];
const byName = new Map();
for (const row of table) {
  const client = toClient(row);
  if (!client) continue;
  const key = normalize(client.name);
  const prev = byName.get(key);
  if (!prev || filled(row, richnessKeys) > filled(prev.row, richnessKeys)) byName.set(key, { client, row });
}
const clients = [...byName.values()].map((e) => e.client);
console.log(`${table.length} CSV rows → ${clients.length} unique companies`);

// --- connect and import
const envUrl = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = /^VITE_SUPABASE_URL=(.+)$/m.exec(envUrl)?.[1]?.trim();
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL in apps/admin/.env or SUPABASE_SERVICE_KEY in the environment.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: {
    fetch: (input, init = {}) =>
      fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) }),
  },
});
let progress = 0;

const { data: existing, error } = await supabase.from("sales_clients").select("id,name");
if (error) throw error;

let created = 0, updated = 0, unchanged = 0;
const failures = [];
for (const client of clients) {
  const key = normalize(client.name);
  const existingClient = (existing || []).find((c) => normalize(c.name) === key);
  if (existingClient) {
    if (dryRun) { updated += 1; continue; }
    const patch = {
      industry: client.industry,
      website: client.website,
      location: client.location,
      tags: client.tags,
      notes: client.notes,
      updated_at: client.updated_at || new Date().toISOString(),
    };
    const { data: current, error: readError } = await supabase
      .from("sales_clients")
      .select("industry,website,location,tags,notes")
      .eq("id", existingClient.id)
      .single();
    if (readError) { failures.push({ name: client.name, error: readError.message }); continue; }
    const same =
      (current.industry || "") === patch.industry &&
      (current.website || "") === patch.website &&
      (current.location || "") === patch.location &&
      (current.notes || "") === patch.notes &&
      JSON.stringify(current.tags || []) === JSON.stringify(patch.tags);
    if (same) { unchanged += 1; continue; }
    const { error: updateError } = await supabase.from("sales_clients").update(patch).eq("id", existingClient.id);
    if (updateError) failures.push({ name: client.name, error: updateError.message });
    else updated += 1;
    progress += 1;
    console.error(`  ${progress}/${clients.length} ${client.name} (updated)`);
    continue;
  }
  if (dryRun) { created += 1; continue; }
  const { error: insertError } = await supabase.from("sales_clients").insert(client);
  if (insertError) failures.push({ name: client.name, error: insertError.message });
  else created += 1;
  progress += 1;
  console.error(`  ${progress}/${clients.length} ${client.name}${insertError ? " ✗" : ""}`);
}

console.log(
  dryRun
    ? `[dry-run] would create ${created}, update ${updated}, leave ${unchanged} unchanged, ${failures.length} failed`
    : `created ${created}, updated ${updated}, unchanged ${unchanged}, ${failures.length} failed`,
);
for (const f of failures) console.error(`  ✗ ${f.name}: ${f.error}`);
process.exit(failures.length ? 1 : 0);
