import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL RLS/privileges/triggers in an isolated database. The existing
// Clerk identity bridge is represented by a verified-profile fixture, not tested here.
test('Kanban permissions, inheritance, attribution, isolation, and revocation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      grant usage on schema public, private, auth to authenticated;
      create table public.profiles(id uuid primary key, full_name text, email text);
      create table public.user_roles(user_id uuid primary key, role text);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create function private.current_user_id() returns uuid language sql stable security definer as $$ select auth.uid() $$;
      alter table public.profiles enable row level security;
      grant select on public.profiles to authenticated;
      create policy own_profile on public.profiles for select to authenticated using(id = auth.uid());
      insert into public.profiles values
        ('10000000-0000-4000-8000-000000000001', 'Admin Alex', 'admin@example.invalid'),
        ('10000000-0000-4000-8000-000000000002', 'Candidate Casey', 'casey@example.invalid'),
        ('10000000-0000-4000-8000-000000000003', 'Outsider', 'outsider@example.invalid');
      insert into public.user_roles select id, case when full_name = 'Admin Alex' then 'admin' else 'candidate' end from public.profiles;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260924182406_kanban_workspace.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260924213447_kanban_admin_deletion.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260924215339_kanban_portal_access_and_creators.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260924215546_kanban_board_editing.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260924220030_kanban_admin_card_deletion.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260924220938_kanban_card_details.sql', import.meta.url), 'utf8'));
    const admin = '10000000-0000-4000-8000-000000000001';
    const candidate = '10000000-0000-4000-8000-000000000002';
    const outsider = '10000000-0000-4000-8000-000000000003';
    const as = async (id, origin = id === admin ? 'https://admin.quicksort.fr' : 'https://candidate.quicksort.fr') => {
      await db.exec('reset role');
      await db.query("select set_config('test.actor', $1, false)", [id]);
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(origin ? {azp: origin} : {})]);
      await db.exec('set role authenticated');
    };
    const insert = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const rows = async table => (await db.query(`select * from public.${table}`)).rows;
    const denied = async (sql, args = [], code = '42501') => assert.rejects(db.query(sql, args), e => e.code === code);
    await as(admin);
    const project = await insert("insert into kanban_projects(name) values('Events') returning *");
    const secretProject = await insert("insert into kanban_projects(name) values('Internal') returning *");
    const board = await insert("insert into kanban_boards(project_id,name) values($1,'Event 1') returning *", [project.id]);
    const sibling = await insert("insert into kanban_boards(project_id,name) values($1,'Event 2') returning *", [project.id]);
    const secret = await insert("insert into kanban_boards(project_id,name) values($1,'Secret') returning *", [secretProject.id]);
    const save = async (projectId, name, drafts, boardId = null) => (await db.query('select save_kanban_board($1,$2,$3::jsonb,$4) as id', [projectId, name, JSON.stringify(drafts), boardId])).rows[0].id;
    const custom = await save(project.id, 'Custom workflow', [{name:'Queued'}, {name:'Review'}]);
    const customColumns = (await rows('kanban_columns')).filter(c => c.board_id === custom);
    assert.deepEqual(customColumns.map(c => c.name), ['Queued', 'Review']);
    const linkedCard = await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Keep me') returning *", [custom, customColumns[0].id]);
    await db.query('insert into kanban_board_members(board_id,user_id) values($1,$2)', [custom, candidate]);
    const drafts = customColumns.map((c,i) => ({id:c.id, name:i === 0 ? 'Ready' : c.name}));
    await save(project.id, 'Renamed workflow', [...drafts, {name:'Completed'}], custom);
    await as(candidate);
    assert.equal((await rows('kanban_boards')).find(b => b.id === custom).name, 'Renamed workflow');
    assert.equal((await rows('kanban_columns')).find(c => c.id === linkedCard.column_id).name, 'Ready');
    assert.equal((await rows('kanban_cards')).find(c => c.id === linkedCard.id).column_id, customColumns[0].id);
    await assert.rejects(save(project.id, 'Forbidden', drafts, custom), e => e.code === '42501');
    assert.equal((await db.query("update kanban_columns set name='Forbidden' where id=$1 returning id", [customColumns[0].id])).rows.length, 0);
    assert.equal((await db.query("update kanban_boards set name='Forbidden' where id=$1 returning id", [custom])).rows.length, 0);
    await as(admin);
    const allDrafts = (await rows('kanban_columns')).filter(c => c.board_id === custom).map(c => ({id:c.id,name:c.name}));
    await assert.rejects(save(project.id, 'Partial change', [...allDrafts, {id:'20000000-0000-4000-8000-000000000001', name:'Wrong board'}], custom), e => e.code === '22023');
    assert.equal((await rows('kanban_boards')).find(b => b.id === custom).name, 'Renamed workflow', 'failed edits roll back the board name too');
    await assert.rejects(save(project.id, 'Missing column', drafts, custom), e => e.code === '22023');
    for (const invalid of [[], [{name:' '}], [{name:'Same'}, {name:' same '}], [{name:'x'.repeat(101)}]]) {
      await assert.rejects(save(project.id, 'Invalid', invalid), e => e.code === '22023');
    }
    assert.ok(!(await rows('kanban_boards')).some(b => b.name === 'Invalid'));
    await denied('delete from kanban_columns where id=$1', [customColumns[0].id], '23503');
    await db.query('delete from kanban_boards where id=$1', [custom]);
    const columns = (await rows('kanban_columns')).filter(c => c.board_id === board.id);
    assert.equal(columns.length, 4, 'board and default columns are created atomically');
    const secretColumn = (await rows('kanban_columns')).find(c => c.board_id === secret.id);
    const siblingColumn = (await rows('kanban_columns')).find(c => c.board_id === sibling.id);
    const adminCard = await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Admin task') returning *", [board.id, columns[0].id]);
    assert.equal(adminCard.creator_name, 'Admin Alex');
    const edited = await insert("update kanban_cards set title='Updated task', description=E'First step\\nSecond step', due_at='2026-10-01 15:30:00+00' where id=$1 returning *", [adminCard.id]);
    assert.equal(edited.title, 'Updated task');
    assert.equal(edited.description, 'First step\nSecond step');
    assert.equal(new Date(edited.due_at).toISOString(), '2026-10-01T15:30:00.000Z');
    assert.equal(edited.created_by, admin);
    await denied("update kanban_cards set title=' ' where id=$1", [adminCard.id], '23514');
    await denied("update kanban_cards set description=$1 where id=$2", ['x'.repeat(4001), adminCard.id], '23514');
    await db.query('update kanban_cards set due_at=null where id=$1', [adminCard.id]);
    assert.equal((await rows('kanban_cards')).find(c => c.id === adminCard.id).due_at, null);

    assert.equal(project.created_by, admin);
    assert.equal(project.creator_name, 'Admin Alex');
    assert.equal(board.created_by, admin);
    assert.equal(board.creator_name, 'Admin Alex');
    await denied("insert into kanban_projects(name,created_by) values('Spoof',$1)", [candidate]);
    await denied("insert into kanban_boards(project_id,name,creator_name) values($1,'Spoof','Someone else')", [project.id]);
    await denied("update kanban_boards set creator_name='Spoof' where id=$1", [board.id]);
    // The exact same admin identity must have no candidate access by default.
    // Neither an arbitrary request header nor a missing/unknown JWT origin grants admin access.
    for (const origin of ['https://candidate.quicksort.fr', 'https://quicksort-candidate.vercel.app', 'http://localhost:5175', 'https://admin.quicksort.fr.attacker.invalid', null]) {
      await as(admin, origin);
      await db.query("select set_config('request.headers', $1, false)", [JSON.stringify({'x-quicksort-portal':'admin',origin:'https://admin.quicksort.fr'})]);
      for (const table of ['kanban_projects','kanban_boards','kanban_columns','kanban_cards']) assert.equal((await rows(table)).length, 0, table + ' isolated for ' + origin);
      await denied("insert into kanban_projects(name) values('Candidate admin')");
      await denied('insert into kanban_board_members(board_id,user_id) values($1,$2)', [board.id,admin]);
      await denied("insert into kanban_cards(board_id,column_id,title) values($1,$2,'No grant')", [board.id,columns[0].id]);
      assert.equal((await db.query('delete from kanban_boards where id=$1 returning id', [board.id])).rows.length, 0);
    }
    // Explicit board grant enables that board only, even for its admin creator.
    await as(admin);
    await db.query('insert into kanban_board_members(board_id,user_id) values($1,$2)', [board.id,admin]);
    await as(admin, 'https://candidate.quicksort.fr');
    assert.deepEqual((await rows('kanban_boards')).map(b=>b.id), [board.id]);
    assert.deepEqual((await rows('kanban_projects')).map(p=>p.id), [project.id]);
    assert.equal((await rows('kanban_columns')).length, 4);
    assert.equal((await rows('kanban_cards')).length, 1);
    await db.query('update kanban_cards set column_id=$1 where id=$2', [columns[1].id,adminCard.id]);
    await denied("update kanban_cards set title='Forbidden' where id=$1", [adminCard.id]);
    await denied("update kanban_cards set due_at=now() where id=$1", [adminCard.id]);

    await denied("insert into kanban_boards(project_id,name) values($1,'Candidate admin')", [project.id]);
    await denied("insert into kanban_columns(board_id,name) values($1,'Candidate admin')", [board.id]);
    assert.equal((await db.query('delete from kanban_projects where id=$1 returning id', [project.id])).rows.length, 0);
    await as(admin);
    await db.query('insert into kanban_project_members(project_id,user_id) values($1,$2)', [project.id,admin]);
    await as(admin, 'https://candidate.quicksort.fr');
    assert.equal((await rows('kanban_boards')).length, 2, 'explicit project grant includes sibling boards only');
    await as(admin);
    await db.query('delete from kanban_project_members where user_id=$1', [admin]);
    await as(admin, 'https://candidate.quicksort.fr');
    assert.equal((await rows('kanban_boards')).length, 1, 'direct grant survives project revocation');
    await as(admin);
    await db.query('delete from kanban_board_members where user_id=$1', [admin]);
    await as(admin, 'https://candidate.quicksort.fr');
    assert.equal((await rows('kanban_cards')).length, 0, 'revoking final grant removes candidate access');
    assert.equal((await db.query('update kanban_cards set column_id=$1 where id=$2 returning id', [columns[0].id,adminCard.id])).rows.length, 0);
    // Admin origin alone cannot upgrade a candidate identity.
    await as(candidate, 'https://admin.quicksort.fr');
    assert.equal((await rows('kanban_boards')).length, 0);
    await denied('insert into kanban_board_members(board_id,user_id) values($1,$2)', [board.id,candidate]);
    await as(admin);
    await db.query('insert into kanban_board_members(board_id,user_id) values($1,$2)', [board.id, candidate]);
    await as(candidate);
    assert.deepEqual((await rows('kanban_boards')).map(b => b.id), [board.id]);
    assert.deepEqual((await rows('kanban_projects')).map(p => p.id), [project.id]);
    assert.equal((await rows('kanban_columns')).length, 4);
    assert.equal((await rows('kanban_cards')).length, 1);
    await denied("insert into kanban_projects(name) values('Forbidden')");
    await denied("insert into kanban_boards(project_id,name) values($1,'Forbidden')", [project.id]);
    await denied("insert into kanban_columns(board_id,name) values($1,'Forbidden')", [board.id]);
    await denied('insert into kanban_project_members(project_id,user_id) values($1,$2)', [project.id,candidate]);
    await denied('insert into kanban_board_members(board_id,user_id) values($1,$2)', [secret.id,candidate]);
    await denied("insert into kanban_cards(board_id,column_id,title,created_by) values($1,$2,'Spoof',$3)", [board.id,columns[0].id,admin]);
    await denied("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Hidden')", [secret.id,secretColumn.id]);
    const card = await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Candidate task') returning *", [board.id,columns[0].id]);
    assert.equal(card.created_by, candidate); assert.equal(card.creator_name, 'Candidate Casey');
    await db.query('update kanban_cards set column_id=$1 where id=$2', [columns[1].id,card.id]);
    await db.query('update kanban_cards set column_id=$1 where id=$2', [columns[1].id,adminCard.id]);
    await denied("update kanban_cards set title='Forbidden' where id=$1", [adminCard.id]);
    await denied("update kanban_cards set due_at=now() where id=$1", [adminCard.id]);

    assert.ok((await rows('kanban_cards')).every(c => c.column_id === columns[1].id));
    await denied('update kanban_cards set column_id=$1 where id=$2', [siblingColumn.id,card.id], '23503');
    await denied("update kanban_cards set creator_name='Spoof' where id=$1", [card.id]);
    await denied("update kanban_cards set title='Edit' where id=$1", [card.id]);
    await denied("update kanban_cards set description='Forbidden' where id=$1", [card.id]);
    await denied("update kanban_cards set due_at=now() where id=$1", [card.id]);

    await denied('update kanban_cards set board_id=$1 where id=$2', [secret.id,card.id]);
    assert.equal((await db.query('delete from kanban_cards where id=$1 returning id', [card.id])).rows.length, 0, 'candidate cannot delete a card');
    for (const [table, id] of [['kanban_projects', project.id], ['kanban_boards', board.id]]) {
      assert.equal((await db.query(`delete from ${table} where id=$1 returning id`, [id])).rows.length, 0, 'candidate cannot delete accessible parents');
    }
    await db.query('delete from kanban_board_members where board_id=$1', [board.id]);
    assert.equal((await rows('kanban_board_members')).length, 1, 'candidate cannot revoke grants');
    await as(outsider);
    for (const table of ['kanban_projects','kanban_boards','kanban_columns','kanban_cards','kanban_board_members','kanban_project_members']) assert.equal((await rows(table)).length, 0, table);
    await as(admin);
    await db.query('insert into kanban_project_members(project_id,user_id) values($1,$2)', [project.id,candidate]);
    const futureBoard = await insert("insert into kanban_boards(project_id,name) values($1,'Future event') returning *", [project.id]);
    await as(candidate);
    assert.equal((await rows('kanban_boards')).length, 3);
    assert.ok((await rows('kanban_boards')).some(b => b.id === futureBoard.id));
    await as(admin);
    await db.query('delete from kanban_project_members where project_id=$1 and user_id=$2', [project.id,candidate]);
    await as(candidate);
    assert.equal((await rows('kanban_boards')).length, 1, 'direct board grant survives project revocation');
    await as(admin);
    await db.query('delete from kanban_board_members where board_id=$1 and user_id=$2', [board.id,candidate]);
    await as(candidate);
    assert.equal((await rows('kanban_cards')).length, 0);
    assert.equal((await db.query('update kanban_cards set column_id=$1 where id=$2 returning id', [columns[0].id,card.id])).rows.length, 0);
    await denied("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Revoked')", [board.id,columns[0].id]);
    await as(admin);
    await db.query('insert into kanban_board_members(board_id,user_id) values($1,$2)', [board.id,candidate]);
    await db.query('insert into kanban_project_members(project_id,user_id) values($1,$2)', [project.id,candidate]);
    const disposable = await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Delete test') returning *", [board.id,columns[0].id]);
    await as(admin, 'https://candidate.quicksort.fr');
    assert.equal((await db.query('delete from kanban_cards where id=$1 returning id', [disposable.id])).rows.length, 0, 'candidate portal cannot delete even with an admin account');
    await as(admin);
    assert.equal((await db.query('delete from kanban_cards where id=$1 returning id', [disposable.id])).rows.length, 1, 'admin can delete a card');
    assert.ok((await rows('kanban_cards')).some(c => c.id === card.id), 'deletion preserves other cards');
    assert.equal((await db.query('delete from kanban_boards where id=$1 and name=$2 returning id', [board.id, 'Wrong name'])).rows.length, 0);
    await db.query('delete from kanban_boards where id=$1 and name=$2', [board.id, board.name]);
    assert.ok(!(await rows('kanban_boards')).some(b => b.id === board.id));
    for (const table of ['kanban_columns','kanban_cards','kanban_board_members']) assert.ok(!(await rows(table)).some(r => r.board_id === board.id), table + ' cascades');
    assert.ok((await rows('kanban_boards')).some(b => b.id === sibling.id), 'sibling survives board deletion');
    await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Nested card') returning *", [sibling.id,siblingColumn.id]);
    await db.query('insert into kanban_board_members(board_id,user_id) values($1,$2)', [sibling.id,candidate]);
    await db.query('delete from kanban_projects where id=$1 and name=$2', [project.id, project.name]);
    assert.deepEqual((await rows('kanban_projects')).map(p => p.id), [secretProject.id]);
    assert.deepEqual((await rows('kanban_boards')).map(b => b.id), [secret.id]);
    assert.ok((await rows('kanban_columns')).every(c => c.board_id === secret.id));
    for (const table of ['kanban_cards','kanban_project_members','kanban_board_members']) assert.equal((await rows(table)).length, 0, table + ' project cascade');
    // Empty projects are deletable too.
    const empty = await insert("insert into kanban_projects(name) values('Empty') returning *");
    await db.query('delete from kanban_projects where id=$1', [empty.id]);
    assert.equal((await rows('kanban_projects')).length, 1);
    await db.exec('reset role; set role anon');
    await denied('delete from kanban_projects');
    await denied('delete from kanban_boards');
    for (const table of ['kanban_projects','kanban_boards','kanban_columns','kanban_cards','kanban_project_members','kanban_board_members']) await denied(`select * from ${table}`);
    await denied('select private.kanban_actor()');
  } finally { await db.close(); }
});
