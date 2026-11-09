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
rollback;
