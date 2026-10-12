#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// An isolated Docker database only. No linked Supabase project or environment credentials.
const container = 'quicksort-hr-verification';
const database = `hr_verify_${Date.now()}`;
const root = resolve(import.meta.dirname, '..');
function psql(sql, db = database) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t'], {
    input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'PostgreSQL verification failed');
  return result.stdout.trim();
}
psql(`create database ${database};`, 'postgres');
console.log(`Isolated database: ${container}/${database}`);
try {
  // Roles are cluster-scoped and already exist on repeat runs.
  const bootstrap = readFileSync(resolve(root, 'tests/hr-postgres-bootstrap.sql'), 'utf8')
    .replace(/create role (anon|authenticated|service_role) ([^;]+);/g, (_, role, attributes) =>
      `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${attributes}; end if; end $$;`);
  psql(bootstrap);
  const files = readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    psql(readFileSync(resolve(root, 'supabase/migrations', file), 'utf8'));
    console.log(`Applied ${file}`);
  }
  const output = psql(readFileSync(resolve(root, 'tests/hr-lifecycle.sql'), 'utf8'));
  const fixture = output.split('\n').find(line => line.startsWith('HR_FIXTURE:'))?.slice('HR_FIXTURE:'.length);
  if (!fixture) throw new Error('Lifecycle verification did not produce its scoped snapshot.');
  JSON.parse(fixture);
  writeFileSync('/tmp/hr-ui-workspace.json', fixture);
  console.log('Saved test-only scoped workspace to /tmp/hr-ui-workspace.json');
  console.log('HR lifecycle database checks passed.');
  psql(readFileSync(resolve(root, 'tests/cra.sql'), 'utf8'));
  console.log('CRA database checks passed: employee/admin access, all activities, dated projects, atomic saves and version conflicts.');
} finally {
  psql(`drop database ${database};`, 'postgres');
}

await import('./verify-hr-concurrency.mjs');

const upgradeDatabase = `${database}_upgrade`;
psql(`create database ${upgradeDatabase};`, 'postgres');
try {
  const bootstrap = readFileSync(resolve(root, 'tests/hr-postgres-bootstrap.sql'), 'utf8')
    .replace(/create role (anon|authenticated|service_role) ([^;]+);/g, (_, role, attributes) =>
      `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${attributes}; end if; end $$;`);
  psql(bootstrap, upgradeDatabase);
  const files = readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === '20261014090000_hr_lifecycle.sql') {
      psql(readFileSync(resolve(root, 'tests/hr-upgrade-fixture.sql'), 'utf8'), upgradeDatabase);
      psql("insert into public.opportunities(title,hiring_mode) values('Unmapped legacy journey','sur_profil');", upgradeDatabase);
      let blocked = false;
      try {
        psql(`begin;\n${readFileSync(resolve(root, 'supabase/migrations', file), 'utf8')}\ncommit;`, upgradeDatabase);
      } catch (error) {
        if (!error.message.includes('full relationship migration is required')) throw error;
        blocked = true;
      }
      if (!blocked || psql("select to_regclass('public.hr_people') is null and to_regnamespace('hr_legacy_20261014') is null and (select count(*) from public.employees)=2;", upgradeDatabase) !== 't') {
        throw new Error('Unsupported legacy journeys must reject the upgrade without changing the existing schema or employee rows.');
      }
      psql("delete from public.opportunities where title='Unmapped legacy journey';", upgradeDatabase);
    }
    psql(`begin;\n${readFileSync(resolve(root, 'supabase/migrations', file), 'utf8')}\ncommit;`, upgradeDatabase);
  }
  psql(readFileSync(resolve(root, 'tests/hr-upgrade-assertions.sql'), 'utf8'), upgradeDatabase);
  console.log('Legacy upgrade passed: preserved identities, dates, notes, audit archives, candidate requests and sales records; actual HR RPC works.');
} finally {
  psql(`drop database ${upgradeDatabase};`, 'postgres');
}
