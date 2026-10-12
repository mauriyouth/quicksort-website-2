import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname, '..');
const container='quicksort-hr-verification';
const database=`hr_race_${Date.now()}`;
function args(db) {
  return ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t'];
}
function run(sql, db = database) {
  const result = spawnSync('docker', args(db), { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'PostgreSQL verification failed');
  return result.stdout.trim();
}
function asyncRun(sql) {
  const child = spawn('docker', args(database));
  let out = '', err = '', announce;
  const ready = new Promise(resolve => { announce = resolve; });
  child.stdout.on('data', chunk => {
    out += chunk;
    if (out.includes('FIRST_SAVED')) announce();
  });
  child.stderr.on('data', chunk => { err += chunk; });
  child.on('error', error => { err += error.message; announce(); });
  const done = new Promise(resolve => {
    child.on('close', status => { announce(); resolve({ status, out, err }); });
  });
  child.stdin.end(sql);
  return { ready, done };
}
const claims=`select set_config('request.jwt.claims','{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}',false);`;
run(`create database ${database};`,'postgres');
try {
 run(readFileSync(`${root}/tests/hr-postgres-bootstrap.sql`,'utf8').replace(/create role (anon|authenticated|service_role) ([^;]+);/g,(_,role,attributes)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${attributes}; end if; end $$;`));
 for(const file of readdirSync(`${root}/supabase/migrations`).filter(f=>f.endsWith('.sql')).sort())run(readFileSync(`${root}/supabase/migrations/${file}`,'utf8'));
 run(`insert into auth.users(id,email,raw_user_meta_data) values('12000000-0000-4000-8000-000000000001','admin@race.invalid','{}');update public.user_roles set role='admin' where user_id='12000000-0000-4000-8000-000000000001';insert into public.sales_clients(id,name) values('12000000-0000-4000-8000-000000000002','Race');insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price) values('12000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000002','Race','forfait',1000);insert into public.hr_people(id,full_name) values('12000000-0000-4000-8000-000000000004','Race Person');insert into public.employees(id,person_id,role,start_date,status) values('12000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000004','Engineer',current_date,'active');`);
 const assignment=n=>JSON.stringify({kind:'assign_project',request_id:`12000000-0000-4000-8000-00000000000${n===60?'6':'7'}`,employee_id:'12000000-0000-4000-8000-000000000005',project_id:'12000000-0000-4000-8000-000000000003',position:'Engineer',allocation_pct:n,status:'confirmed'});
 const sql=n=>`select public.hr_command('${assignment(n)}'::jsonb||jsonb_build_object('start_date',current_date,'end_date',current_date+30));`;
 const first=asyncRun(`begin;${claims}${sql(60)}select 'FIRST_SAVED';select pg_sleep(0.5);commit;`);
 await first.ready;
 const second=asyncRun(`begin;${claims}${sql(50)}commit;`);
 const [one,two]=await Promise.all([first.done,second.done]);
 if(one.status!==0||two.status===0||!two.err.includes('capacity'))throw Error(`Concurrent capacity did not serialize: ${JSON.stringify({one,two})}`);
 if(run('select count(*)||\':\'||sum(allocation_pct) from public.employee_project_assignments;')!=='1:60')throw Error('Concurrent capacity left incorrect commitments');
 const request=JSON.stringify({kind:'create_person',request_id:'12000000-0000-4000-8000-000000000008',full_name:'Retry Person'});
 const retry=asyncRun(`begin;${claims}select public.hr_command('${request}');select 'FIRST_SAVED';select pg_sleep(0.5);commit;`);
 await retry.ready;
 const twin=asyncRun(`begin;${claims}select public.hr_command('${request}');commit;`);
 const [r1,r2]=await Promise.all([retry.done,twin.done]);
 if(r1.status!==0||r2.status!==0)throw Error('Concurrent identical receipt retry failed');
 if(run("select count(*) from public.hr_people where full_name='Retry Person';")!=='1'||run("select count(*) from public.hr_events where request_id='12000000-0000-4000-8000-000000000008';")!=='1')throw Error('Concurrent retry duplicated identity or event');
 console.log('Proved: concurrent over-capacity assignment rejected; concurrent identical request creates one person and one event.');
 run(`insert into auth.users(id,email,raw_user_meta_data) values('12000000-0000-4000-8000-000000000009','employee@race.invalid','{}');insert into public.hr_person_accounts(profile_id,person_id,linked_by) values('12000000-0000-4000-8000-000000000009','12000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001');`);
 const employeeClaims=`select set_config('request.jwt.claims','{"sub":"12000000-0000-4000-8000-000000000009","role":"authenticated"}',false);`;
 const craSave=status=>`select public.cra_save_month('12000000-0000-4000-8000-000000000005',date_trunc('month',current_date)::date,0,jsonb_build_array(jsonb_build_object('day',current_date,'status','${status}','project_id',null)));`;
 const adminSave=asyncRun(`begin;${claims}${craSave('internal')}select 'FIRST_SAVED';select pg_sleep(0.5);commit;`);
 await adminSave.ready;
 const employeeSave=asyncRun(`begin;${employeeClaims}${craSave('rtt')}commit;`);
 const [adminResult,employeeResult]=await Promise.all([adminSave.done,employeeSave.done]);
 if(adminResult.status!==0||employeeResult.status===0||!employeeResult.err.includes('another person'))throw Error(`Concurrent CRA save did not reject stale edits: ${JSON.stringify({adminResult,employeeResult})}`);
 if(run("select version||':'||status from public.cra_months join public.cra_entries using(employee_id,month);")!=='1:internal')throw Error('Concurrent CRA save overwrote the first editor');
 console.log('Proved: concurrent admin/employee CRA saves preserve the first save and reject the stale edit.');
} finally {
  run(`drop database ${database};`, 'postgres');
}
