#!/usr/bin/env node
/**
 * One-off: rename every active payslip to the current naming scheme,
 * "<MM>_<owner>_payslip.pdf" (documentFileName), in Google Drive and in
 * public.documents.file_name. Uses the owner's current name, so payslips moved
 * to another person lose the previous person's name too.
 *
 * Dry run by default — prints the plan. Pass --apply to rename.
 *
 *   VITE_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… AI_SETTINGS_ENCRYPTION_KEY=… \
 *     node apps/admin/scripts/rename-payslip-files.ts [--apply]
 *
 * Safe to re-run: rows already carrying their target name are skipped. Each
 * file is renamed in Drive first, then in the database; if the database update
 * fails the Drive rename is reverted.
 */
import { createClient } from "@supabase/supabase-js";
import { documentFileName } from "../server/documents/folders.ts";
import { driveApi, loadDriveSettings } from "../server/documents/storage/google-drive.ts";

const apply = process.argv.includes("--apply");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.AI_SETTINGS_ENCRYPTION_KEY) {
  console.error("Set VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AI_SETTINGS_ENCRYPTION_KEY.");
  process.exit(1);
}
const client = createClient(url, key, { auth: { persistSession: false } });

type Row = { id: string; person_id: string; title: string; valid_from: string | null; file_name: string; storage_provider: string; provider_file_id: string };

const { data: docs, error } = await client.from("documents")
  .select("id,person_id,title,valid_from,file_name,storage_provider,provider_file_id")
  .eq("type_code", "PAYSLIP").eq("status", "active").order("valid_from");
if (error) throw error;
const rows = (docs ?? []) as Row[];

const names = new Map<string, string>();
const personIds = [...new Set(rows.map((r) => r.person_id))];
for (let i = 0; i < personIds.length; i += 100) {
  const { data, error: peopleError } = await client.from("hr_people").select("id,full_name").in("id", personIds.slice(i, i + 100));
  if (peopleError) throw peopleError;
  for (const p of data ?? []) names.set(p.id, p.full_name);
}

const plan = rows.flatMap((row) => {
  const target = documentFileName("PAYSLIP", names.get(row.person_id) ?? "", row.file_name, row.title, row.valid_from);
  return target === row.file_name ? [] : [{ row, target }];
});

console.log(`${rows.length} active payslips, ${plan.length} to rename, ${rows.length - plan.length} already named.`);
const skipped = plan.filter(({ row }) => row.storage_provider !== "gdrive");
for (const { row } of skipped) console.log(`  skip (storage ${row.storage_provider}): ${row.file_name}`);
const todo = plan.filter(({ row }) => row.storage_provider === "gdrive");
for (const { row, target } of todo) console.log(`  ${row.file_name}  →  ${target}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to rename.");
  process.exit(0);
}

const settings = await loadDriveSettings(client);
if (!settings) throw new Error("No Google Drive connection is saved.");
const rename = (fileId: string, name: string) =>
  driveApi(settings, `/files/${fileId}`, { method: "PATCH", query: { supportsAllDrives: "true", fields: "id,name" }, body: { name } });

let done = 0;
let failed = 0;
for (const { row, target } of todo) {
  try {
    await rename(row.provider_file_id, target);
    const { error: updateError } = await client.from("documents").update({ file_name: target }).eq("id", row.id);
    if (updateError) {
      await rename(row.provider_file_id, row.file_name).catch(() => undefined);
      throw updateError;
    }
    done++;
  } catch (e) {
    failed++;
    console.error(`  FAILED ${row.file_name} (${row.id}): ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  }
}
console.log(`\nRenamed ${done}, failed ${failed}.`);
process.exit(failed ? 1 : 0);
