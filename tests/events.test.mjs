import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('event publishing, admin permissions, validation and banner storage policies', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   create role anon; create role authenticated;
   create schema private; create schema storage;
   grant usage on schema public, private, storage to anon, authenticated;
   create function private.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false') = 'true' $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant select,insert,delete on storage.objects to anon,authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260927214521_event_cards.sql',import.meta.url),'utf8'));
  const as = async (role, admin=false) => {await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[String(admin)]);await db.exec(`set role ${role}`);};
  await as('anon');
  assert.equal((await db.query('select * from events')).rows.length,2,'both supplied events seeded');
  await assert.rejects(db.query("update events set title='unauthorized'"),e=>e.code==='42501');
  await as('authenticated');
  assert.equal((await db.query("update events set title='unauthorized' returning id")).rows.length,0);
  const insert="insert into events(title,event_date,location,event_url,banner_url) values('New event','2026-11-01','Paris',$1,'https://www.quicksort.fr/events/cafe-compute-paris.jpg') returning *";
  await assert.rejects(db.query(insert,['https://luma.com/new-event']),e=>e.code==='42501');
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('event-banners','bad.jpg')"),e=>e.code==='42501');
  await as('authenticated',true);
  const draft=(await db.query(insert,['https://luma.com/new-event'])).rows[0];
  await assert.rejects(db.query(insert,['javascript:alert(1)']),e=>e.code==='23514');
  await assert.rejects(db.query("update events set banner_url='https://evil.example/banner.jpg' where id=$1",[draft.id]),e=>e.code==='23514');
  await db.query("insert into storage.objects(bucket_id,name) values('event-banners','good.jpg')");
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('contracts','bad.jpg')"),e=>e.code==='42501');
  await as('anon');assert.equal((await db.query('select * from events')).rows.length,2,'draft is private');
  await as('authenticated',true);
  const edited=(await db.query('update events set published=true where id=$1 and updated_at=$2 returning *',[draft.id,draft.updated_at])).rows[0];
  assert.notEqual(edited.updated_at,draft.updated_at);
  assert.equal((await db.query("update events set title='stale edit' where id=$1 and updated_at=$2 returning id",[draft.id,draft.updated_at])).rows.length,0);
  await as('anon');assert.equal((await db.query('select * from events')).rows.length,3);
  await as('authenticated',true);await db.query('update events set published=false where id=$1',[draft.id]);
  await as('anon');assert.equal((await db.query('select * from events')).rows.length,2,'unpublished card disappears');
 } finally {await db.close();}
});
