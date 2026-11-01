begin;
grant select on public.sales_projects, public.sales_project_extensions, public.admin_statuses, public.employees, public.hr_events to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','ps-hr@example.invalid','{}'),
 ('51000000-0000-4000-8000-000000000002','ps-employee@example.invalid','{}');
update public.user_roles set role='hr' where user_id='51000000-0000-4000-8000-000000000001';
insert into public.hr_people(id,full_name,email) values
 ('52000000-0000-4000-8000-000000000001','Payslip Person A','ps-a@example.invalid'),
 ('52000000-0000-4000-8000-000000000002','Payslip Person B','ps-b@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('51000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,end_date,status,contract_type) values
 ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','2024-01-01','2024-12-31','ended','CDD');
insert into public.employees(id,person_id,start_date,status,contract_type) values
 ('53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','2026-01-01','active','CDI'),
 ('53000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','2026-01-01','active','CDI');
insert into public.documents(id,type_code,owner_kind,person_id,title,status,valid_from,storage_provider,provider_file_id,file_name,mime_type,size_bytes) values
 ('54000000-0000-4000-8000-000000000001','PAYSLIP','person','52000000-0000-4000-8000-000000000001','Bulletin 2026-09','active','2026-09-01','gdrive','ps-a-active','a-active.pdf','application/pdf',1000),
 ('54000000-0000-4000-8000-000000000002','PAYSLIP','person','52000000-0000-4000-8000-000000000001','Bulletin 2026-08','archived','2026-08-01','gdrive','ps-a-archived','a-archived.pdf','application/pdf',1000),
 ('54000000-0000-4000-8000-000000000003','PAYSLIP','person','52000000-0000-4000-8000-000000000002','Bulletin 2026-09','active','2026-09-01','gdrive','ps-b-active','b-active.pdf','application/pdf',1000);
insert into public.google_drive_settings(id,encrypted_credentials) values ('default','cipher-text');

create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true);
$$;
create function pg_temp.must_fail(statement text, expected text) returns void language plpgsql as $$
 declare failed boolean := false;
 begin
  begin execute statement; exception when others then failed := sqlerrm like '%'||expected||'%'; if not failed then raise exception 'FAILED: wrong error for %: %',statement,sqlerrm; end if; end;
  if not failed then raise exception 'FAILED: expected rejection: %',expected; end if;
 end;
$$;

select pg_temp.assert_true(exists(select 1 from public.document_types where code='PAYSLIP' and folder='bulletins' and sensitive and required_for='{}'),'PAYSLIP type is sensitive, in bulletins, required for nobody');

-- HR operator manages matricules per person.
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.document_alerts where person_id='52000000-0000-4000-8000-000000000001' and type_code='PAYSLIP')=0,'No missing-payslip alert');
create temp table v0 as select version from public.employees where id='53000000-0000-4000-8000-000000000002';
grant select on pg_temp.v0 to authenticated;
select public.set_employee_matricule('53000000-0000-4000-8000-000000000002','  00026 ');
select pg_temp.assert_true((select matricule='00026' and version=(select version from pg_temp.v0)+1 from public.employees where id='53000000-0000-4000-8000-000000000002'),'Matricule trimmed, stored, version bumped');
select pg_temp.assert_true(exists(select 1 from public.hr_events where kind='matricule_changed' and employee_id='53000000-0000-4000-8000-000000000002' and next_state='00026' and previous_state like 'QS-%'),'Matricule change is audited with old and new values');
select public.set_employee_matricule('53000000-0000-4000-8000-000000000001','00026');
select pg_temp.assert_true((select matricule from public.employees where id='53000000-0000-4000-8000-000000000001')='00026','Same person may share a matricule across employments');
select pg_temp.must_fail($q$select public.set_employee_matricule('53000000-0000-4000-8000-000000000003','00026')$q$,'already belongs to');
select pg_temp.must_fail($q$select public.set_employee_matricule('53000000-0000-4000-8000-000000000003','bad matricule!')$q$,'Matricule');
select pg_temp.must_fail($q$select public.set_employee_matricule('53000000-0000-4000-8000-000000000003','')$q$,'Matricule');

-- The employee can neither set a matricule nor see the registry.
select pg_temp.as_user('51000000-0000-4000-8000-000000000002');
select pg_temp.must_fail($q$select public.set_employee_matricule('53000000-0000-4000-8000-000000000002','99999')$q$,'');
select pg_temp.assert_true((select count(*) from public.my_payslips)=1,'Employee sees only their active payslip');
select pg_temp.assert_true((select count(*) from public.documents)=0,'Registry RLS is unchanged for employees');
select pg_temp.assert_true((select count(*) from public.payslip_download_source('54000000-0000-4000-8000-000000000003'))=0,'Another person payslip is not downloadable');
select pg_temp.assert_true((select count(*) from public.payslip_download_source('54000000-0000-4000-8000-000000000002'))=0,'Archived payslip is not downloadable');
select pg_temp.assert_true((select count(*) from public.payslip_download_source('54000000-0000-4000-8000-000000000001') where provider_file_id='ps-a-active' and encrypted_credentials='cipher-text')=1,'Own active payslip is downloadable');
reset role;
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_accessed' and next_state='54000000-0000-4000-8000-000000000001' and actor_id='51000000-0000-4000-8000-000000000002')=1,'Download is audited with the employee as actor');
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_accessed')=1,'Refused downloads leave no audit row');

-- Moving a payslip: archive the old row, register the new one, audit both people.
insert into public.documents(id,type_code,owner_kind,person_id,title,status,valid_from,expires_on,storage_provider,provider_file_id,file_name,mime_type,size_bytes) values
 ('54000000-0000-4000-8000-000000000004','CNI','person','52000000-0000-4000-8000-000000000001','CNI','active',null,'2035-01-01','gdrive','ps-a-cni','cni.pdf','application/pdf',10);
select pg_temp.as_user('51000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.must_fail($q$select public.move_payslip('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','folder-b')$q$,'Not allowed');
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
select pg_temp.must_fail($q$select public.move_payslip('54000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000002','folder-b')$q$,'Only an active payslip');
select pg_temp.must_fail($q$select public.move_payslip('54000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000002','folder-b')$q$,'Only an active payslip');
select pg_temp.must_fail($q$select public.move_payslip('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','folder-b')$q$,'Choose a different person');
select public.move_payslip('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','folder-b');
reset role;
select pg_temp.assert_true((select status='archived' and notes='Moved to Payslip Person B' from public.documents where id='54000000-0000-4000-8000-000000000001'),'Old payslip is archived with a pointer');
select pg_temp.assert_true((select count(*)=1 from public.documents where person_id='52000000-0000-4000-8000-000000000002' and provider_file_id='ps-a-active' and status='active' and provider_folder_id='folder-b' and title='Bulletin 2026-09' and valid_from='2026-09-01' and notes='Moved from Payslip Person A' and uploaded_by='51000000-0000-4000-8000-000000000001'),'New payslip shares the file id and belongs to the new person');
select pg_temp.assert_true((select count(*)=2 and count(distinct person_id)=2 from public.hr_events where kind='document_moved' and previous_state='54000000-0000-4000-8000-000000000001'),'Both people get a document_moved event');
select pg_temp.must_fail($q$insert into public.documents(type_code,owner_kind,person_id,title,storage_provider,provider_file_id,file_name) values('OTHER','person','52000000-0000-4000-8000-000000000001','dup','gdrive','ps-a-active','x.pdf')$q$,'duplicate key');

-- The matricule owner rule also holds for raw inserts.
select pg_temp.must_fail($q$insert into public.employees(person_id,start_date,status,contract_type,matricule) values('52000000-0000-4000-8000-000000000002','2027-01-01','active','CDI','00026')$q$,'already belongs to');
select pg_temp.assert_true(not exists(select 1 from pg_constraint where conname='employees_matricule_key'),'Global matricule uniqueness is gone');
rollback;
