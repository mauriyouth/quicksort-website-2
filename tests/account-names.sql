begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','an-admin@example.invalid','{}'),
 ('71000000-0000-4000-8000-000000000002','an-hr@example.invalid','{}'),
 ('71000000-0000-4000-8000-000000000003','an-candidate@example.invalid','{"full_name":"Self Named"}');
update public.user_roles set role='admin' where user_id='71000000-0000-4000-8000-000000000001';
update public.user_roles set role='hr' where user_id='71000000-0000-4000-8000-000000000002';
update public.profiles set full_name='Self Named' where id='71000000-0000-4000-8000-000000000003';
insert into public.hr_people(id,full_name,email) values
 ('72000000-0000-4000-8000-000000000001','Amadou Record','Amadou.Record@example.invalid'),
 ('72000000-0000-4000-8000-000000000002','No Email Person',''),
 ('72000000-0000-4000-8000-000000000003','Linked Later','linked-later@example.invalid');

create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.rejects(statement text, pattern text) returns boolean language plpgsql as $$
 begin execute statement; return false; exception when others then return sqlerrm ~* pattern; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true);
$$;

-- HR creates the portal account of a person: email and name from the record, linked at once.
select pg_temp.as_user('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select public.create_workspace_account('73000000-0000-4000-8000-000000000001','ignored@example.invalid','employee','72000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(pg_temp.rejects($q$select public.create_workspace_account('73000000-0000-4000-8000-000000000009','x@example.invalid','hr','72000000-0000-4000-8000-000000000003')$q$,'Only administrators'),'HR cannot create an HR account');
select pg_temp.assert_true(pg_temp.rejects($q$select public.create_workspace_account('73000000-0000-4000-8000-000000000009','x@example.invalid','employee')$q$,'Only administrators'),'HR cannot create an unlinked account');
select pg_temp.assert_true(pg_temp.rejects($q$select public.create_workspace_account('73000000-0000-4000-8000-000000000009','','employee','72000000-0000-4000-8000-000000000002')$q$,'Add an email address to No Email Person'),'A person without email gets no account');
select pg_temp.assert_true(pg_temp.rejects($q$select public.create_workspace_account('73000000-0000-4000-8000-000000000009','','employee','72000000-0000-4000-8000-000000000001')$q$,'already has a portal account'),'A person gets one account');
reset role;
select pg_temp.assert_true((select email='amadou.record@example.invalid' and full_name='Amadou Record' from public.profiles where id='73000000-0000-4000-8000-000000000001'),'Profile takes the record email and name');
select pg_temp.assert_true((select role='employee' from public.user_roles where user_id='73000000-0000-4000-8000-000000000001'),'Role is set');
select pg_temp.assert_true((select person_id='72000000-0000-4000-8000-000000000001' and linked_by='71000000-0000-4000-8000-000000000002' from public.hr_person_accounts where profile_id='73000000-0000-4000-8000-000000000001'),'Account is linked by HR');

-- The linked employee cannot drift from the HR name; HR renaming follows through.
select pg_temp.as_user('73000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_true(public.my_name_from_hr(),'Linked account: name managed by HR');
update public.profiles set full_name='Nickname' where id='73000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select full_name='Amadou Record' from public.profiles where id='73000000-0000-4000-8000-000000000001'),'Self edit of a linked name is put back');
reset role;
update public.hr_people set full_name='Amadou Renamed' where id='72000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select full_name='Amadou Renamed' from public.profiles where id='73000000-0000-4000-8000-000000000001'),'HR rename reaches the profile');

-- An unlinked candidate keeps and edits their own name until HR links them.
select pg_temp.as_user('71000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_true(not public.my_name_from_hr(),'Unlinked account: own name');
update public.profiles set full_name='Self Renamed' where id='71000000-0000-4000-8000-000000000003';
select pg_temp.assert_true((select full_name='Self Renamed' from public.profiles where id='71000000-0000-4000-8000-000000000003'),'Unlinked account edits its name');
reset role;
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values ('71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000002');
select pg_temp.assert_true((select full_name='Linked Later' from public.profiles where id='71000000-0000-4000-8000-000000000003'),'Linking an existing account takes the HR name');

-- Admins still create plain accounts by email, without a name.
select pg_temp.as_user('71000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.create_workspace_account('73000000-0000-4000-8000-000000000002','Sales.Person@example.invalid','sales');
reset role;
select pg_temp.assert_true((select email='sales.person@example.invalid' and full_name='' from public.profiles where id='73000000-0000-4000-8000-000000000002'),'Admin creates an unlinked account by email');
rollback;
