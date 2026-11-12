#!/usr/bin/env node
// Report a person's employments and every invoice mentioning them, including
// drafts, ignored rows and invoices without a period month. Companion to
// fill-cra-from-invoices.mjs; same QS_TOKEN.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const name = process.argv[2];
const token = process.env.QS_TOKEN;
if (!name || !token) { console.error('Usage: QS_TOKEN=<jwt> node scripts/report-cra-invoices.mjs "<name>"'); process.exit(1); }
const env = readFileSync(resolve(import.meta.dirname, '../apps/admin/.env'), 'utf8');
const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();
const apikey = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
async function rest(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey, Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const people = await rest(`hr_people?select=id,full_name&full_name=ilike.*${encodeURIComponent(name)}*`);
const person = people[0];
if (!person) throw new Error(`No person matches "${name}".`);
console.log(`Person: ${person.full_name}`);
const employments = await rest(`employees?select=id,start_date,end_date,status,contract_type&person_id=eq.${person.id}&order=start_date`);
console.log('Employments:');
for (const e of employments) console.log(`  ${e.start_date} -> ${e.end_date ?? 'open'}  ${e.status}  ${e.contract_type}`);
const invoices = await rest(`invoices?select=id,number,status,source,project_id,period_month,employee_id,issue_date,ignored,total_ht&employee_id=in.(${employments.map(e => e.id).join(',')})&order=issue_date`);
console.log(`\nInvoices (${invoices.length}):`);
for (const i of invoices) {
  const lines = await rest(`invoice_lines?select=quantity,title&invoice_id=eq.${i.id}`);
  const qty = lines.reduce((sum, l) => sum + Number(l.quantity), 0);
  console.log(`  ${i.issue_date ?? '(no date)'}  ${i.period_month ? i.period_month.slice(0, 7) : '(no period)'}  ${i.status}${i.ignored ? ' IGNORED' : ''}  ${i.number ?? ''}  ${qty} days  ${lines.map(l => l.title).join(' | ')}`);
}
