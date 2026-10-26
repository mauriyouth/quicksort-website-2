#!/usr/bin/env node
// One-off generator: builds the employee_salaries migration from the current
// hr_workspace_snapshot (20261031090000) and hr_command (20261108090000)
// bodies so the replaced functions stay byte-identical apart from the
// salary additions. Run: node scripts/gen-salary-migration.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const snapshotSrc = readFileSync(resolve(root, 'supabase/migrations/20261031090000_assignment_pricing_line.sql'), 'utf8');
const commandSrc = readFileSync(resolve(root, 'supabase/migrations/20261108090000_optional_engagement_rationale.sql'), 'utf8');

const snapshotFn = snapshotSrc.slice(snapshotSrc.indexOf('create or replace function public.hr_workspace_snapshot'));
const commandFn = commandSrc.slice(commandSrc.indexOf('create or replace function public.hr_command'));

function patch(source, replacements, label) {
  for (const [from, to] of replacements) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`${label}: expected 1 occurrence, found ${count} for: ${from.slice(0, 80)}`);
    source = source.replace(from, to);
  }
  return source;
}

const snapshotNew = patch(snapshotFn, [[
  " 'employees',coalesce((select jsonb_agg(e order by start_date desc) from public.employees e),'[]'),",
  " 'employees',coalesce((select jsonb_agg(e order by start_date desc) from public.employees e),'[]'),\n 'salaries',case when hr then coalesce((select jsonb_agg(s order by start_date) from public.employee_salaries s),'[]') else '[]'::jsonb end,",
]], 'snapshot');

const commandNew = patch(commandFn, [
  // 1. declare block: add the salary row variable
  [
    "ass public.employee_project_assignments; opp public.opportunities; s public.hr_ai_suggestions; p public.hr_people;",
    "ass public.employee_project_assignments; opp public.opportunities; s public.hr_ai_suggestions; p public.hr_people; sal public.employee_salaries;",
  ],
  // 2. allowed/required keys
  [
    " when 'cancel_hire' then allowed:=array['employee_id','expected_version','kind','rationale','request_id']; required_keys:=array['employee_id','expected_version','kind','rationale','request_id'];",
    " when 'cancel_hire' then allowed:=array['employee_id','expected_version','kind','rationale','request_id']; required_keys:=array['employee_id','expected_version','kind','rationale','request_id'];\n when 'save_salary' then allowed:=array['employee_id','end_date','expected_version','kind','rationale','request_id','salary_id','salary_monthly','start_date']; required_keys:=array['employee_id','kind','request_id','salary_monthly','start_date'];",
  ],
  // 3. record-id to employment resolution
  [
    " if command ? 'item_id' then select exit_root.employee_id into emp from public.offboarding_records exit_root join public.offboarding_items exit_item on exit_item.offboarding_id=exit_root.id where exit_item.id=(command->>'item_id')::uuid; end if;",
    " if command ? 'item_id' then select exit_root.employee_id into emp from public.offboarding_records exit_root join public.offboarding_items exit_item on exit_item.offboarding_id=exit_root.id where exit_item.id=(command->>'item_id')::uuid; end if;\n if command ? 'salary_id' then select employee_id into emp from public.employee_salaries where id=(command->>'salary_id')::uuid; end if;",
  ],
  // 4. hire seeds the initial salary from the accepted offer
  [
    "  insert into public.employees(person_id,application_id,offer_id,role,contract_type,manager_email,parrain,start_date,probation_end)\n  values(person,app,o.id,command->>'role',o.contract_type,coalesce(command->>'manager_email',''),coalesce(command->>'parrain',''),startday,nullif(command->>'probation_end','')::date) returning id into emp;",
    "  insert into public.employees(person_id,application_id,offer_id,role,contract_type,manager_email,parrain,start_date,probation_end)\n  values(person,app,o.id,command->>'role',o.contract_type,coalesce(command->>'manager_email',''),coalesce(command->>'parrain',''),startday,nullif(command->>'probation_end','')::date) returning id into emp;\n  if o.salary_monthly>0 then insert into public.employee_salaries(employee_id,salary_monthly,start_date,rationale) values(emp,o.salary_monthly,startday,'Initial salary from the accepted offer'); end if;",
  ],
  // 4b. completed exit closes the salary history at the exit date; annulled hires drop the seeded entry
  [
    "   update public.employee_project_assignments set status=case when start_date>x.exit_date then 'cancelled' else 'completed' end,end_date=case when start_date>x.exit_date then end_date else least(coalesce(end_date,x.exit_date),x.exit_date) end,version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');\n   update public.employees set status='ended',end_date=x.exit_date,",
    "   update public.employee_project_assignments set status=case when start_date>x.exit_date then 'cancelled' else 'completed' end,end_date=case when start_date>x.exit_date then end_date else least(coalesce(end_date,x.exit_date),x.exit_date) end,version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');\n   delete from public.employee_salaries where employee_id=emp and start_date>x.exit_date;\n   update public.employee_salaries set end_date=least(coalesce(end_date,x.exit_date),x.exit_date),version=version+1,updated_at=now() where employee_id=emp and (end_date is null or end_date>x.exit_date);\n   update public.employees set status='ended',end_date=x.exit_date,",
  ],
  [
    "  if exists(select 1 from public.offboarding_records where employee_id=emp and status='open') then raise exception 'An open exit already exists for this employment.'; end if;\n  update public.employee_project_assignments set status='cancelled',version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');",
    "  if exists(select 1 from public.offboarding_records where employee_id=emp and status='open') then raise exception 'An open exit already exists for this employment.'; end if;\n  update public.employee_project_assignments set status='cancelled',version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');\n  delete from public.employee_salaries where employee_id=emp;",
  ],
  // 5. handler after update_employment
  [
    " when 'cancel_hire' then\n  perform private.hr_version(e.version,command->'expected_version');",
    ` when 'save_salary' then
  if emp is null then raise exception 'Employment required.'; end if;
  if (command->>'salary_monthly')::numeric<0 then raise exception 'Salary must be zero or positive.'; end if;
  startday:=(command->>'start_date')::date; endday:=nullif(command->>'end_date','')::date;
  if endday is not null and endday<startday then raise exception 'Salary end date cannot precede its start date.'; end if;
  if startday<e.start_date or (e.end_date is not null and startday>e.end_date) or (e.end_date is not null and endday>e.end_date) then raise exception 'Salary dates must fit the employment period.'; end if;
  if e.status='ended' and endday is null then raise exception 'Ended employment only accepts salary entries closed with an end date.'; end if;
  if command ? 'salary_id' then
   select * into sal from public.employee_salaries where id=(command->>'salary_id')::uuid for update;
   if not found then raise exception 'Salary entry not found.'; end if;
   if sal.employee_id<>emp then raise exception 'Salary entry does not belong to this employment.'; end if;
   perform private.hr_version(sal.version,command->'expected_version');
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'A rationale is required to change a recorded salary.'; end if;
   prev:=sal.salary_monthly::text;
   update public.employee_salaries set salary_monthly=(command->>'salary_monthly')::numeric,start_date=startday,end_date=endday,rationale=command->>'rationale',version=version+1,updated_at=now() where id=sal.id returning id,version into item,source_version;
  else
   if endday is null and exists(select 1 from public.employee_salaries where employee_id=emp and end_date is null and start_date>=startday) then raise exception 'An open salary entry already starts on or after this date.'; end if;
   update public.employee_salaries set end_date=startday-1,version=version+1,updated_at=now() where employee_id=emp and end_date is null and start_date<startday returning salary_monthly::text into prev;
   if exists(select 1 from public.employee_salaries where employee_id=emp and start_date<=coalesce(endday,'infinity'::date) and coalesce(end_date,'infinity'::date)>=startday) then raise exception 'Salary intervals cannot overlap.'; end if;
   insert into public.employee_salaries(employee_id,salary_monthly,start_date,end_date,rationale) values(emp,(command->>'salary_monthly')::numeric,startday,endday,coalesce(command->>'rationale','')) returning id,version into item,source_version;
  end if;
  nxt:=command->>'salary_monthly';
  result:=result||jsonb_build_object('salary_id',item,'version',source_version);
 when 'cancel_hire' then
  perform private.hr_version(e.version,command->'expected_version');`,
  ],
], 'command');

const migration = `-- Employee salaries: each employment period carries a dated salary history
-- instead of a single figure, so raises and corrections stay auditable.
-- employee_salaries stores non-overlapping intervals per employment period;
-- the interval with a null end_date is the current one. Hiring seeds the
-- first interval from the accepted offer, and save_salary records changes:
-- a new entry closes the previous open interval the day before it starts.
-- Staff-only accounts see no salary data (the snapshot gates it like offers).
create table public.employee_salaries (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 salary_monthly numeric not null check (salary_monthly >= 0),
 start_date date not null,
 end_date date,
 rationale text not null default '' check (length(rationale) <= 2000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (end_date is null or end_date >= start_date)
);

create unique index hr_one_open_salary on public.employee_salaries(employee_id) where end_date is null;

create index hr_salaries_employee on public.employee_salaries(employee_id,start_date,end_date);

alter table public.employee_salaries enable row level security;

create policy employee_salaries_admin on public.employee_salaries for all to authenticated
 using (true) with check (true);

${snapshotNew}
${commandNew}
`;

writeFileSync(resolve(root, 'supabase/migrations/20261109090000_employee_salaries.sql'), migration);
console.log('Wrote supabase/migrations/20261109090000_employee_salaries.sql');
