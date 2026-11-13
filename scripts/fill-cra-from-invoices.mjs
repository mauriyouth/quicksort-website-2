#!/usr/bin/env node
// Fill CRA days from full-month invoices, for one person.
//
// For every month where a finalized/paid, non-ignored invoice bills this
// person for a quantity of days >= the month's working days (Mon-Fri minus
// French public holidays) on a single project, fill the empty working days
// of that CRA month with client_project entries on that project. Days that
// already have a CRA entry are left as they are.
//
// Usage:
//   QS_TOKEN=<clerk supabase-template jwt> node scripts/fill-cra-from-invoices.mjs "Abed EL BEINANE" [--dry-run]
//
// The token is the same one as cra-invoice-gap-scan.sh:
//   copy(await window.Clerk.session.getToken({template:"supabase"}))

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const name = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
// Map invoices without a period_month to a work month from their issue date:
// issued by the 10th -> previous month's work, later -> that month's work.
const inferPeriods = process.argv.includes('--infer-periods');
if (!name) {
  console.error('Usage: QS_TOKEN=<jwt> node scripts/fill-cra-from-invoices.mjs "<person name>" [--dry-run]');
  process.exit(1);
}
const token = process.env.QS_TOKEN;
if (!token) {
  console.error('Set QS_TOKEN to a Clerk supabase-template JWT.');
  process.exit(1);
}

const env = readFileSync(resolve(import.meta.dirname, '../apps/admin/.env'), 'utf8');
const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();
const apikey = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
if (!url || !apikey) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env');

async function rest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return data;
}
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: args });

// Same holiday rule as apps/admin/src/cra/domain.ts (no Alsace-Moselle extras).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
function workingDays(month) {
  const year = Number(month.slice(0, 4));
  const easter = easterSunday(year);
  const holidays = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`, `${year}-08-15`,
    `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
    iso(shift(easter, 1)), iso(shift(easter, 39)), iso(shift(easter, 50)),
  ]);
  const count = new Date(year, Number(month.slice(5)), 0).getDate();
  const days = [];
  for (let d = 1; d <= count; d++) {
    const date = new Date(year, Number(month.slice(5)) - 1, d);
    const key = iso(date);
    if (![0, 6].includes(date.getDay()) && !holidays.has(key)) days.push(key);
  }
  return days;
}

const people = await rest(`hr_people?select=id,full_name&full_name=ilike.*${encodeURIComponent(name)}*`);
if (!people.length) throw new Error(`No person matches "${name}".`);
const person = people.find((p) => p.full_name.toLowerCase().includes(name.toLowerCase())) ?? people[0];
console.log(`Person: ${person.full_name} (${person.id})`);
if (people.length > 1) console.log(`(other matches: ${people.filter((p) => p.id !== person.id).map((p) => p.full_name).join(', ')})`);

const employments = await rest(`employees?select=id,start_date,end_date,status,contract_type&person_id=eq.${person.id}&order=start_date`);
if (!employments.length) throw new Error('No employment found for this person.');
const employeeIds = employments.map((e) => e.id);
const employmentFor = (day) => employments.find((e) => day >= e.start_date && (!e.end_date || day <= e.end_date));

const invoiceSelect = 'id,number,status,project_id,period_month,issue_date,employee_id';
const invoices = await rest(`invoices?select=${invoiceSelect}&employee_id=in.(${employeeIds.join(',')})&status=in.(finalized,paid)&ignored=eq.false&order=issue_date`);
const shiftMonth = (isoDate, delta) => {
  const date = new Date(`${isoDate}T12:00:00`);
  return new Date(date.getFullYear(), date.getMonth() + delta, 1).toISOString().slice(0, 7);
};
const withMonth = invoices.map((invoice) => {
  if (invoice.period_month) return { ...invoice, work_month: invoice.period_month.slice(0, 7), inferred: false };
  if (!inferPeriods || !invoice.issue_date) return { ...invoice, work_month: null, inferred: false };
  const day = Number(invoice.issue_date.slice(8, 10));
  return { ...invoice, work_month: shiftMonth(invoice.issue_date, day <= 10 ? -1 : 0), inferred: true };
}).filter((i) => i.work_month);
if (!withMonth.length) { console.log('No finalized/paid invoices with a work month. Nothing to do.'); process.exit(0); }

const lines = await rest(`invoice_lines?select=invoice_id,quantity&invoice_id=in.(${withMonth.map((i) => i.id).join(',')})`);
const qtyByInvoice = new Map();
for (const line of lines) qtyByInvoice.set(line.invoice_id, (qtyByInvoice.get(line.invoice_id) ?? 0) + Number(line.quantity));

// Group billed days by (month, employee, project).
const billed = new Map();
for (const invoice of withMonth) {
  const key = `${invoice.work_month}|${invoice.employee_id}|${invoice.project_id ?? 'none'}`;
  billed.set(key, (billed.get(key) ?? 0) + (qtyByInvoice.get(invoice.id) ?? 0));
}

for (const [key, daysBilled] of [...billed.entries()].sort()) {
  const [month, employeeId, projectId] = key.split('|');
  const days = workingDays(month);
  const inferred = withMonth.some((i) => i.work_month === month && i.employee_id === employeeId && (i.project_id ?? 'none') === projectId && i.inferred);
  const tag = inferred ? ' (month inferred from issue date)' : '';
  const projectLabel = projectId === 'none' ? 'no project' : projectId;
  if (daysBilled < days.length) {
    console.log(`${month}: ${daysBilled} days billed of ${days.length} working days (${projectLabel})${tag}. Not a full month, skipped.`);
    continue;
  }
  if (projectId === 'none') {
    console.log(`${month}: full month billed but the invoice has no project${tag}. Skipped.`);
    continue;
  }
  const snapshot = await rpc('cra_month_snapshot', { target_employee: employeeId, target_month: `${month}-01` });
  const existing = snapshot.entries ?? [];
  const covered = new Set(existing.map((e) => e.day));
  const fillable = days.filter((day) => !covered.has(day) && employmentFor(day)?.id === employeeId);
  if (!fillable.length) {
    console.log(`${month}: already fully covered (${existing.length} existing entries)${tag}. Nothing to add.`);
    continue;
  }
  const assignments = await rest(`employee_project_assignments?select=project_id,start_date,end_date,status&employee_id=eq.${employeeId}&project_id=eq.${projectId}`);
  const assigned = fillable.filter((day) =>
    assignments.some((a) => ['confirmed', 'active', 'completed'].includes(a.status) && a.start_date <= day && (!a.end_date || a.end_date >= day)));
  if (assigned.length !== fillable.length) {
    console.log(`${month}: WARNING ${fillable.length - assigned.length} days are outside the assignment window. Saving only the ${assigned.length} assigned days.`);
  }
  const entries = [...existing, ...assigned.map((day) => ({ day, part: 'full', status: 'client_project', project_id: projectId }))];
  if (dryRun) {
    console.log(`${month}: DRY RUN would save ${assigned.length} days on project ${projectId}${tag} (month version ${snapshot.version}).`);
    continue;
  }
  const saved = await rpc('cra_save_month', { target_employee: employeeId, target_month: `${month}-01`, expected_version: snapshot.version, entries });
  console.log(`${month}: saved ${assigned.length} days on project ${projectId}${tag}. Month now at version ${saved.version} with ${(saved.entries ?? []).length} entries.`);
}
