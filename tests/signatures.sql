begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','sig-admin@example.invalid','{}'),
 ('51000000-0000-4000-8000-000000000002','sig-employee@example.invalid','{}'),
 ('51000000-0000-4000-8000-000000000003','sig-hr@example.invalid','{}');
update public.user_roles set role='admin' where user_id='51000000-0000-4000-8000-000000000001';
update public.user_roles set role='hr' where user_id='51000000-0000-4000-8000-000000000003';
insert into public.hr_people(id,full_name,email) values
 ('52000000-0000-4000-8000-000000000001','Sig Employee','sig-employee@example.invalid'),
 ('52000000-0000-4000-8000-000000000002','Sig Other','sig-other@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('51000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status,contract_type) values
 ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','2026-01-01','active','CDI');

create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true);
$$;
create function pg_temp.contract(file_id text) returns jsonb language sql as $$
 select jsonb_build_object('owner_kind','person','person_id','52000000-0000-4000-8000-000000000001','type_code','EMPLOYMENT_CONTRACT',
  'title','Contrat '||file_id,'storage_provider','gdrive','provider_file_id',file_id,'file_name',file_id||'.pdf','mime_type','application/pdf');
$$;

select pg_temp.assert_true((select label='Courrier période d''essai' and folder='contrat_travail' and owner_kinds='{person}'
  from public.document_types where code='PROBATION_LETTER'),'Probation letter document type exists');

-- Admins manage templates and requests through RLS.
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.signature_templates(id,name,google_doc_id,signers,type_code,created_by) values
 ('54000000-0000-4000-8000-000000000001','CDI standard','doc-cdi','person_and_quicksort','EMPLOYMENT_CONTRACT','51000000-0000-4000-8000-000000000001');
insert into public.signature_requests(id,person_id,template_id,title,type_code,signers,status,created_by) values
 ('55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  'Contrat CDI','EMPLOYMENT_CONTRACT',
  '[{"role":"person","name":"Sig Employee","email":"sig-employee@example.invalid","order":1},{"role":"quicksort","name":"Admin","email":"sig-admin@example.invalid","order":2}]',
  'draft','51000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*) from public.signature_templates)=1,'Admin sees templates');
select pg_temp.assert_true((select count(*) from public.signature_requests)=1,'Admin sees requests');
select pg_temp.assert_true((select field_values='{}'::jsonb and error='' from public.signature_requests),'Request defaults');
do $$ begin
 begin
  perform count(*) from public.signature_settings;
  raise exception 'FAILED: Admin read signature settings directly';
 exception when insufficient_privilege then null; end;
 begin
  perform count(*) from public.signature_webhook_events;
  raise exception 'FAILED: Admin read webhook events directly';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- HR operators and employees see nothing and write nothing.
create function pg_temp.assert_locked_out(who text) returns void language plpgsql as $$
begin
 perform pg_temp.assert_true((select count(*) from public.signature_templates)=0, who||' cannot see templates');
 perform pg_temp.assert_true((select count(*) from public.signature_requests)=0, who||' cannot see requests');
 begin
  insert into public.signature_templates(name,google_doc_id,signers,type_code) values('Sneaky '||who,'doc-x','person','OTHER');
  raise exception 'FAILED: % inserted a template', who;
 exception when insufficient_privilege then null; end;
 begin
  insert into public.signature_requests(person_id,title,type_code,signers,status,created_by) values
   ('52000000-0000-4000-8000-000000000001','Sneaky','OTHER','[]','draft','51000000-0000-4000-8000-000000000001');
  raise exception 'FAILED: % inserted a request', who;
 exception when insufficient_privilege then null; end;
end; $$;
select pg_temp.as_user('51000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_locked_out('HR');
reset role;
select pg_temp.as_user('51000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_locked_out('Employee');
reset role;

-- Signed-document filing is service-role only, even for admins.
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ begin
 begin
  perform public.register_signed_document('55000000-0000-4000-8000-000000000001',pg_temp.contract('signed-x'),null);
  raise exception 'FAILED: authenticated filed a signed document';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- register_document still works for admins (guards the refactor).
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.register_document(pg_temp.contract('contract-v1'));
reset role;
select pg_temp.assert_true((select uploaded_by='51000000-0000-4000-8000-000000000001' and status='active'
  from public.documents where provider_file_id='contract-v1'),'register_document still files as the caller');
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_registered' and next_state=(select id::text from public.documents where provider_file_id='contract-v1'))=1,
  'register_document still audits person documents');

-- The webhook runs as service_role with no signed-in user.
select set_config('request.jwt.claims','',true);
set local role service_role;
do $$ begin
 begin
  perform public.register_signed_document(gen_random_uuid(),pg_temp.contract('signed-unknown'),null);
  raise exception 'FAILED: filed against an unknown request';
 exception when others then if sqlerrm <> 'Unknown signature request.' then raise; end if; end;
end; $$;
do $$ begin
 begin
  perform public.register_signed_document('55000000-0000-4000-8000-000000000001',
   pg_temp.contract('signed-other') || '{"person_id":"52000000-0000-4000-8000-000000000002"}',null);
  raise exception 'FAILED: filed a document for another person';
 exception when others then if sqlerrm <> 'Document does not belong to this signature request.' then raise; end if; end;
end; $$;
select public.register_signed_document('55000000-0000-4000-8000-000000000001',pg_temp.contract('signed-v2'),
  (select id from public.documents where provider_file_id='contract-v1'));
reset role;
select pg_temp.assert_true((select count(*) from public.documents where provider_file_id='signed-other')=0,'A mismatched person files nothing');
select pg_temp.assert_true((select uploaded_by='51000000-0000-4000-8000-000000000001' and type_code='EMPLOYMENT_CONTRACT' and status='active'
  from public.documents where provider_file_id='signed-v2'),'Signed document is filed as the request creator');
select pg_temp.assert_true((select status='superseded' and superseded_by=(select id from public.documents where provider_file_id='signed-v2')
  from public.documents where provider_file_id='contract-v1'),'Signed document supersedes the chosen document');
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_registered'
  and request_id='55000000-0000-4000-8000-000000000001'
  and actor_id='51000000-0000-4000-8000-000000000001'
  and employee_id='53000000-0000-4000-8000-000000000001'
  and next_state=(select id::text from public.documents where provider_file_id='signed-v2'))=1,
  'Signed filing is audited under the signature request id');

-- Timestamps follow edits and status changes.
alter table public.signature_requests disable trigger user;
update public.signature_requests set status_changed_at=now()-interval '1 day', updated_at=now()-interval '1 day';
alter table public.signature_requests enable trigger user;
update public.signature_requests set youtrust_request_id='yt-1';
select pg_temp.assert_true((select updated_at>now()-interval '1 hour' and status_changed_at<now()-interval '1 hour' from public.signature_requests),
  'Editing a request bumps updated_at only');
update public.signature_requests set status='sent';
select pg_temp.assert_true((select status_changed_at>now()-interval '1 hour' from public.signature_requests),'Status change bumps status_changed_at');

-- Completion filing claims the request (column exists, starts unclaimed).
select pg_temp.assert_true((select filing_claimed_at is null from public.signature_requests),'A request starts with no filing claim');

-- Hiring requires a completed Youtrust contract linked to the application.
insert into public.hr_people(id,full_name,email) values
 ('52000000-0000-4000-8000-000000000003','Sig Candidate','sig-candidate@example.invalid'),
 ('52000000-0000-4000-8000-000000000004','Sig Second','sig-second@example.invalid');
-- An application at Contract with interviews held and an accepted offer: hireable but for the contract.
create function pg_temp.hireable_application(id uuid, person uuid, title text) returns uuid language plpgsql as $$
declare opp uuid;
begin
 insert into public.opportunities(title,hiring_mode,status) values(title,'sur_mission','approved') returning opportunities.id into opp;
 insert into public.hr_applications(id,person_id,opportunity_id,stage) values(id,person,opp,'contract');
 insert into public.interviews(application_id,kind,scheduled_at,status,scorecard) values
  (id,'hr',now()-interval '2 days','completed','[{"competency":"Experience","rating":4,"evidence":"Held"}]'),
  (id,'technical',now()-interval '1 day','completed','[{"competency":"Experience","rating":4,"evidence":"Held"}]');
 insert into public.offers(application_id,title,contract_type,salary_monthly,cjm,target_tjm,status) values(id,title,'CDI',4000,300,600,'accepted');
 return id;
end; $$;
select pg_temp.hireable_application('56000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000003','Platform Engineer');
select pg_temp.hireable_application('56000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000003','Data Engineer');
select pg_temp.hireable_application('56000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000004','Backend Engineer');
create function pg_temp.hire(app uuid) returns jsonb language sql as $$
 select public.hr_command(jsonb_build_object('kind','hire','request_id',gen_random_uuid(),'application_id',app,
  'expected_version',(select version from public.hr_applications where id=app),'start_date',current_date,'role','Engineer'));
$$;
create function pg_temp.hire_refused(app uuid, description text) returns void language plpgsql as $$
begin
 begin
  perform pg_temp.hire(app);
  raise exception 'FAILED: hired %', description;
 exception when others then
  if sqlerrm <> 'Hire prerequisites: The contract is signed in Youtrust' then raise exception 'FAILED: % (got %)', description, sqlerrm; end if;
 end;
end; $$;
insert into public.signature_requests(id,person_id,application_id,title,type_code,signers,status,created_by) values
 ('55000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-000000000001',
  'Contrat CDI','EMPLOYMENT_CONTRACT','[]','sent','51000000-0000-4000-8000-000000000001');
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select not (j->>'done')::boolean from jsonb_array_elements(public.hr_application_requirements('56000000-0000-4000-8000-000000000001','hire')) j
  where j->>'key'='signatures' and j->>'label'='The contract is signed in Youtrust'),'The hire requirement carries the Youtrust label');
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a contract still waiting for a signature');
update public.signature_requests set status='completed',
  signed_document_id=(select id from public.documents where provider_file_id='signed-v2'),
  application_id='56000000-0000-4000-8000-000000000002'
 where id='55000000-0000-4000-8000-000000000002';
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a contract signed for another application of the same person');
update public.signature_requests set application_id=null where id='55000000-0000-4000-8000-000000000002';
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a contract sent without an application');
update public.signature_requests set application_id='56000000-0000-4000-8000-000000000001',person_id='52000000-0000-4000-8000-000000000002'
 where id='55000000-0000-4000-8000-000000000002';
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a contract signed by another person');
update public.signature_requests set person_id='52000000-0000-4000-8000-000000000003',signed_document_id=null where id='55000000-0000-4000-8000-000000000002';
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a completed contract whose signed copy is not filed');
update public.signature_requests set signed_document_id=(select id from public.documents where provider_file_id='signed-v2'),type_code='OTHER'
 where id='55000000-0000-4000-8000-000000000002';
select pg_temp.hire_refused('56000000-0000-4000-8000-000000000001','on a completed, filed request that is not a contract');
update public.signature_requests set type_code='EMPLOYMENT_CONTRACT' where id='55000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select (j->>'done')::boolean from jsonb_array_elements(public.hr_application_requirements('56000000-0000-4000-8000-000000000001','hire')) j
  where j->>'key'='signatures'),'A completed, filed contract linked to the application meets the requirement');
select pg_temp.hire('56000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select status='hired' from public.hr_applications where id='56000000-0000-4000-8000-000000000001'),'Admin hires on a linked Youtrust contract');

-- HR-role users cannot read signature_requests, yet can hire when the contract is signed.
insert into public.signature_requests(person_id,application_id,title,type_code,signers,status,signed_document_id,created_by) values
 ('52000000-0000-4000-8000-000000000004','56000000-0000-4000-8000-000000000003','Contrat CDI','EMPLOYMENT_CONTRACT','[]','completed',
  (select id from public.documents where provider_file_id='signed-v2'),'51000000-0000-4000-8000-000000000001');
select pg_temp.as_user('51000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.hire('56000000-0000-4000-8000-000000000003');
reset role;
select pg_temp.assert_true((select status='hired' from public.hr_applications where id='56000000-0000-4000-8000-000000000003'),'HR-role user hires on a linked Youtrust contract');

-- The old in-app contract tables are gone, and so are their workspace keys.
select pg_temp.assert_true(to_regclass('public.contracts') is null,'contracts is dropped');
select pg_temp.assert_true(to_regclass('public.contract_signatures') is null,'contract_signatures is dropped');
select pg_temp.assert_true(to_regclass('public.contract_countersignatures') is null,'contract_countersignatures is dropped');
select pg_temp.as_user('51000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select not (s ? 'contracts') and not (s ? 'signatures') and not (s ? 'countersignatures') from public.hr_workspace_snapshot() s),
  'The workspace snapshot has no old contract keys');
rollback;
