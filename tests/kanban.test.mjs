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
    const admin = '10000000-0000-4000-8000-000000000001';
    const candidate = '10000000-0000-4000-8000-000000000002';
    const outsider = '10000000-0000-4000-8000-000000000003';
    const as = async id => { await db.exec('reset role'); await db.query("select set_config('test.actor', $1, false)", [id]); await db.exec('set role authenticated'); };
    const insert = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const rows = async table => (await db.query(`select * from public.${table}`)).rows;
    const denied = async (sql, args = [], code = '42501') => assert.rejects(db.query(sql, args), e => e.code === code);
    await as(admin);
    const project = await insert("insert into kanban_projects(name) values('Events') returning *");
    const secretProject = await insert("insert into kanban_projects(name) values('Internal') returning *");
    const board = await insert("insert into kanban_boards(project_id,name) values($1,'Event 1') returning *", [project.id]);
    const sibling = await insert("insert into kanban_boards(project_id,name) values($1,'Event 2') returning *", [project.id]);
    const secret = await insert("insert into kanban_boards(project_id,name) values($1,'Secret') returning *", [secretProject.id]);
    const columns = (await rows('kanban_columns')).filter(c => c.board_id === board.id);
    assert.equal(columns.length, 4, 'board and default columns are created atomically');
    const secretColumn = (await rows('kanban_columns')).find(c => c.board_id === secret.id);
    const siblingColumn = (await rows('kanban_columns')).find(c => c.board_id === sibling.id);
    const adminCard = await insert("insert into kanban_cards(board_id,column_id,title) values($1,$2,'Admin task') returning *", [board.id, columns[0].id]);
    assert.equal(adminCard.creator_name, 'Admin Alex');
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
    assert.ok((await rows('kanban_cards')).every(c => c.column_id === columns[1].id));
    await denied('update kanban_cards set column_id=$1 where id=$2', [siblingColumn.id,card.id], '23503');
    await denied("update kanban_cards set creator_name='Spoof' where id=$1", [card.id]);
    await denied("update kanban_cards set title='Edit' where id=$1", [card.id]);
    await denied('update kanban_cards set board_id=$1 where id=$2', [secret.id,card.id]);
    await denied('delete from kanban_cards where id=$1', [card.id]);
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
