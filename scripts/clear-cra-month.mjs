#!/usr/bin/env node
// Clear one CRA month for a person (save an empty month through cra_save_month,
// so the version bump and audit fields stay consistent). Same QS_TOKEN as the
// other CRA scripts.
// Usage: QS_TOKEN=<jwt> node scripts/clear-cra-month.mjs "<name>" <YYYY-MM>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [name, month] = process.argv.slice(2);
const token = process.env.QS_TOKEN;
if (!name || !month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !token) {
  console.error('Usage: QS_TOKEN=<jwt> node scripts/clear-cra-month.mjs "<name>" <YYYY-MM>');
  process.exit(1);
}
const env = readFileSync(resolve(import.meta.dirname, '../apps/admin/.env'), 'utf8');
const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();
const apikey = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
async function rest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const people = await rest(`hr_people?select=id,full_name&full_name=ilike.*${encodeURIComponent(name)}*`);
const person = people[0];
if (!person) throw new Error(`No person matches "${name}".`);
const employments = await rest(`employees?select=id,start_date,end_date&person_id=eq.${person.id}`);
const employment = employments.find((e) => e.start_date <= `${month}-28` && (!e.end_date || e.end_date >= `${month}-01`)) ?? employments[0];
const snapshot = await rest('rpc/cra_month_snapshot', { method: 'POST', body: { target_employee: employment.id, target_month: `${month}-01` } });
console.log(`${person.full_name} ${month}: ${snapshot.entries.length} entries at version ${snapshot.version}. Clearing.`);
const saved = await rest('rpc/cra_save_month', { method: 'POST', body: { target_employee: employment.id, target_month: `${month}-01`, expected_version: snapshot.version, entries: [] } });
console.log(`Cleared. Month now at version ${saved.version} with ${saved.entries.length} entries.`);
