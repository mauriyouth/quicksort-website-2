begin;
-- Supabase grants table access to authenticated by default; the bare test
-- cluster does not, and the alerts view reads these tables as the caller.
grant select on public.sales_projects, public.sales_project_extensions, public.admin_statuses, public.employees to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('41000000-0000-4000-8000-000000000001','doc-admin@example.invalid','{}'),
 ('41000000-0000-4000-8000-000000000002','doc-employee@example.invalid','{}'),
 ('41000000-0000-4000-8000-000000000003','doc-hr@example.invalid','{}'),
 ('41000000-0000-4000-8000-000000000004','doc-sales@example.invalid','{}');
update public.user_roles set role='admin' where user_id='41000000-0000-4000-8000-000000000001';
update public.user_roles set role='hr' where user_id='41000000-0000-4000-8000-000000000003';
update public.user_roles set role='sales' where user_id='41000000-0000-4000-8000-000000000004';
insert into public.hr_people(id,full_name,email) values
 ('42000000-0000-4000-8000-000000000001','Doc Employee','doc-employee@example.invalid'),
 ('42000000-0000-4000-8000-000000000002','Doc Alumni','doc-alumni@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('41000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status,contract_type) values
 ('43000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','2026-01-01','active','CDI');
insert into public.employees(id,person_id,start_date,end_date,status,contract_type) values
 ('43000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002','2025-01-01','2025-12-31','ended','CDI');
insert into public.sales_clients(id,name) values('44000000-0000-4000-8000-000000000001','Doc Client');
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price) values
 ('45000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','Doc project','forfait',10000);
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price,status) values
 ('45000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000001','Archived project','forfait',10000,'archive');
insert into public.sales_project_extensions(id,project_id,label,pricing_model,fixed_price,status) values
 ('46000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','Extension Q1','forfait',5000,'signed');

create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true);
$$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Paris')::date $$;
create function pg_temp.person_doc(type_code text, file_id text, expires date) returns jsonb language sql as $$
 select jsonb_build_object('owner_kind','person','person_id','42000000-0000-4000-8000-000000000001','type_code',type_code,
  'title',type_code,'storage_provider','gdrive','provider_file_id',file_id,'file_name',file_id||'.pdf','expires_on',expires);
$$;
create function pg_temp.alerts(kind text, code text) returns bigint language sql as $$
 select count(*) from public.document_alerts where severity=kind and type_code=code;
$$;

-- Missing alerts before anything is uploaded: the active CDI employee, the
-- running project and its signed extension; never the alumni or archived project.
select pg_temp.as_user('41000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_true(pg_temp.alerts('missing','CNI')=1,'Identity (CNI or passport) is one missing requirement');
select pg_temp.assert_true(pg_temp.alerts('missing','PASSPORT')=0,'Passport does not raise a second identity alert');
select pg_temp.assert_true(pg_temp.alerts('missing','CARTE_VITALE')=1,'CDI requires a carte vitale');
select pg_temp.assert_true(pg_temp.alerts('missing','KBIS')=0,'Kbis is only required for freelancers');
select pg_temp.assert_true(pg_temp.alerts('missing','TITRE_SEJOUR')=0,'Unknown nationality requires no titre de séjour');
reset role;
update public.employees set nationality='DE' where id='43000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(pg_temp.alerts('missing','TITRE_SEJOUR')=0,'EU nationals need no titre de séjour');
select public.hr_command(jsonb_build_object('kind','update_employment','employee_id','43000000-0000-4000-8000-000000000001',
 'expected_version',(select version from public.employees where id='43000000-0000-4000-8000-000000000001'),'nationality','MA','request_id',gen_random_uuid()));
do $$ begin
 begin
  perform public.hr_command(jsonb_build_object('kind','update_employment','employee_id','43000000-0000-4000-8000-000000000001',
   'expected_version',(select version from public.employees where id='43000000-0000-4000-8000-000000000001'),'nationality','Maroc','request_id',gen_random_uuid()));
  raise exception 'FAILED: free-text nationality accepted';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;
select pg_temp.assert_true(pg_temp.alerts('missing','TITRE_SEJOUR')=1,'Non-EU nationals need a titre de séjour');
select pg_temp.assert_true((select count(*) from public.document_alerts where person_id='42000000-0000-4000-8000-000000000002')=0,'Ended employment raises no alert');
select pg_temp.assert_true((select count(*) from public.document_alerts where severity='missing' and type_code='CLIENT_CONTRACT' and project_id='45000000-0000-4000-8000-000000000001')=1,'Running project misses its main contract');
select pg_temp.assert_true((select count(*) from public.document_alerts where project_id='45000000-0000-4000-8000-000000000002')=0,'Archived project raises no alert');
select pg_temp.assert_true((select count(*) from public.document_alerts where extension_id='46000000-0000-4000-8000-000000000001')=1,'Signed extension misses its avenant');

-- A passport satisfies the identity requirement; expiry thresholds follow warn_days {90,30}.
select public.register_document(pg_temp.person_doc('PASSPORT','pass-1',pg_temp.today()+25));
select pg_temp.assert_true(pg_temp.alerts('missing','CNI')=0,'Passport satisfies identity');
select pg_temp.assert_true((select days_left from public.document_alerts where severity='expiring' and type_code='PASSPORT')=25,'Passport expiring in 25 days');
select public.register_document(pg_temp.person_doc('VISITE_MEDICALE','visite-1',pg_temp.today()-1));
select pg_temp.assert_true(pg_temp.alerts('expired','VISITE_MEDICALE')=1,'Visite médicale expired yesterday');
select public.register_document(pg_temp.person_doc('CERTIFICATION','cert-1',pg_temp.today()+90));
select pg_temp.assert_true(pg_temp.alerts('expiring','CERTIFICATION')=0,'Certification outside its 30-day window');
do $$ begin
 begin
  perform public.register_document(pg_temp.person_doc('CNI','cni-no-date',null));
  raise exception 'FAILED: CNI registered without expiry';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;

-- Renewal supersedes the old passport atomically and clears its alert.
select public.register_document(pg_temp.person_doc('PASSPORT','pass-2',pg_temp.today()+3650),
 (select id from public.documents where provider_file_id='pass-1'));
select pg_temp.assert_true((select status='superseded' and superseded_by is not null from public.documents where provider_file_id='pass-1'),'Old passport superseded');
select pg_temp.assert_true(pg_temp.alerts('expiring','PASSPORT')=0,'Renewal clears the passport alert');
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_registered' and person_id='42000000-0000-4000-8000-000000000001')=4,'Each person document is audited');

-- Files and owners are immutable; metadata is not.
update public.documents set title='Passeport 2036', notes='renouvelé' where provider_file_id='pass-2';
select pg_temp.assert_true((select version=2 from public.documents where provider_file_id='pass-2'),'Metadata edit bumps version');
do $$ begin
 begin
  update public.documents set provider_file_id='swapped' where provider_file_id='pass-2';
  raise exception 'FAILED: file swapped in place';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;

-- Project main contract, annex linked to it, avenant linked to the extension.
select public.register_document(jsonb_build_object('owner_kind','project','project_id','45000000-0000-4000-8000-000000000001',
 'type_code','CLIENT_CONTRACT','title','Contrat','storage_provider','gdrive','provider_file_id','contract-1','file_name','contrat.pdf'));
select public.register_document(jsonb_build_object('owner_kind','project','project_id','45000000-0000-4000-8000-000000000001',
 'type_code','AVENANT','title','Avenant Q1','storage_provider','gdrive','provider_file_id','avenant-1','file_name','avenant.pdf',
 'extension_id','46000000-0000-4000-8000-000000000001','parent_document_id',(select id from public.documents where provider_file_id='contract-1')));
select pg_temp.assert_true((select count(*) from public.document_alerts where project_id='45000000-0000-4000-8000-000000000001')=0,'Project fully documented');
do $$ begin
 begin
  perform public.register_document(jsonb_build_object('owner_kind','person','person_id','42000000-0000-4000-8000-000000000001',
   'type_code','CLIENT_CONTRACT','title','x','storage_provider','gdrive','provider_file_id','wrong-owner','file_name','x.pdf'));
  raise exception 'FAILED: project type accepted on a person';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;
reset role;

-- HR sees person documents, sales sees neither, the employee sees nothing.
insert into public.google_drive_settings(id,encrypted_credentials) values('connection','v1.ciphertext');
grant select on public.google_drive_settings to authenticated;
select pg_temp.as_user('41000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.google_drive_settings)=1,'HR reads the Drive connection to upload person documents');
select pg_temp.assert_true((select count(*) from public.documents where owner_kind='person')=4,'HR reads person documents');
select pg_temp.assert_true((select count(*) from public.documents where owner_kind='project')=0,'HR does not read project documents');
reset role;
select pg_temp.as_user('41000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.documents)=0,'Sales role reads no documents');
select pg_temp.assert_true((select count(*) from public.google_drive_settings)=0,'Sales role cannot read the Drive connection');
do $$ begin
 begin
  perform public.register_document(jsonb_build_object('owner_kind','person','person_id','42000000-0000-4000-8000-000000000001',
   'type_code','RIB','title','x','storage_provider','gdrive','provider_file_id','sales-rib','file_name','x.pdf'));
  raise exception 'FAILED: sales registered a person document';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;
reset role;
select pg_temp.as_user('41000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.documents)=0,'Employee reads no documents');
select pg_temp.assert_true((select count(*) from public.document_alerts)=0,'Employee sees no alerts');
do $$ begin
 begin
  delete from public.documents;
  if (select count(*) from public.documents)=0 then null; end if;
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.assert_true((select count(*) from public.documents)=6,'No document was deleted');

-- Candidate uploads arrive for review; resumes stay out; deletion archives.
insert into public.candidate_documents(id,candidate_id,name,category,storage_path,size_bytes) values
 ('48000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','cni.jpg','identity','41000000-0000-4000-8000-000000000002/cni.jpg',2048),
 ('48000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','cv.pdf','resume','41000000-0000-4000-8000-000000000002/cv.pdf',2048),
 ('48000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000002','master.pdf','qualification','41000000-0000-4000-8000-000000000002/master.pdf',2048);
select pg_temp.assert_true((select type_code='OTHER' and needs_review and mime_type='image/jpeg' from public.documents where provider_file_id='candidate-documents/41000000-0000-4000-8000-000000000002/cni.jpg'),'Identity upload waits for classification');
select pg_temp.assert_true(not exists(select 1 from public.documents where file_name='cv.pdf'),'Resumes are not registered');
select pg_temp.assert_true((select type_code from public.documents where file_name='master.pdf')='DIPLOMA','Qualifications arrive as diplomas to confirm');

-- Classification: the one allowed type change, under register rules.
select pg_temp.as_user('41000000-0000-4000-8000-000000000003');
set local role authenticated;
do $$ begin
 begin
  update public.documents set type_code='CNI', needs_review=false where file_name='cni.jpg';
  raise exception 'FAILED: CNI classified without an expiry';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
 begin
  update public.documents set type_code='CLIENT_CONTRACT', needs_review=false, expires_on=null where file_name='cni.jpg';
  raise exception 'FAILED: project type set on a person';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
 begin
  update public.documents set type_code='RIB' where provider_file_id='pass-2';
  raise exception 'FAILED: type of a reviewed document changed';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;
update public.documents set type_code='CNI', needs_review=false, expires_on='2034-03-01', title='CNI' where file_name='cni.jpg';
select pg_temp.assert_true((select type_code='CNI' and not needs_review from public.documents where file_name='cni.jpg'),'HR classifies the upload as a CNI');
reset role;
delete from public.candidate_documents where id='48000000-0000-4000-8000-000000000003';
select pg_temp.assert_true((select status from public.documents where file_name='master.pdf')='archived','Candidate deletion archives the registry row');

-- Linking an account later brings existing uploads along.
insert into auth.users(id,email,raw_user_meta_data) values ('41000000-0000-4000-8000-000000000005','doc-late@example.invalid','{}');
insert into public.hr_people(id,full_name) values ('42000000-0000-4000-8000-000000000003','Late Link');
insert into public.candidate_documents(candidate_id,name,category,storage_path,size_bytes) values
 ('41000000-0000-4000-8000-000000000005','rib.pdf','other','41000000-0000-4000-8000-000000000005/rib.pdf',100);
select pg_temp.assert_true(not exists(select 1 from public.documents where file_name='rib.pdf'),'Unlinked candidate uploads wait');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('41000000-0000-4000-8000-000000000005','42000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select person_id from public.documents where file_name='rib.pdf')='42000000-0000-4000-8000-000000000003','Linking registers earlier uploads');

-- A récépissé is a temporary titre de séjour: it satisfies the requirement,
-- and an expired permit stops alerting once a more up-to-date one is filed.
insert into public.hr_people(id,full_name) values ('42000000-0000-4000-8000-000000000004','Residence Permit');
insert into public.employees(id,person_id,start_date,status,contract_type,nationality) values
 ('43000000-0000-4000-8000-000000000004','42000000-0000-4000-8000-000000000004','2026-01-01','active','CDI','MA');
create function pg_temp.permit(type_code text, file_id text, expires date) returns jsonb language sql as $$
 select jsonb_build_object('owner_kind','person','person_id','42000000-0000-4000-8000-000000000004','type_code',type_code,
  'title',type_code,'storage_provider','gdrive','provider_file_id',file_id,'file_name',file_id||'.pdf','expires_on',expires);
$$;
create function pg_temp.permit_alerts(kind text) returns bigint language sql as $$
 select count(*) from public.document_alerts where person_id='42000000-0000-4000-8000-000000000004' and severity=kind
  and type_code in ('TITRE_SEJOUR','TITRE_SEJOUR_RECEPISSE');
$$;
set local role authenticated;
select pg_temp.assert_true(pg_temp.alerts('missing','TITRE_SEJOUR')>=1 and pg_temp.permit_alerts('missing')=1,'Non-EU employee misses one residence permit');
select public.register_document(pg_temp.permit('TITRE_SEJOUR','ts-old',pg_temp.today()-30));
select public.register_document(pg_temp.permit('TITRE_SEJOUR_RECEPISSE','rec-1',pg_temp.today()+60));
select pg_temp.assert_true(pg_temp.permit_alerts('missing')=0,'Récépissé satisfies the residence requirement');
select pg_temp.assert_true(pg_temp.permit_alerts('expired')=0,'Expired titre covered by a newer récépissé raises no alert');
select public.register_document(pg_temp.permit('TITRE_SEJOUR_RECEPISSE','rec-0',pg_temp.today()-200));
select public.register_document(pg_temp.permit('TITRE_SEJOUR','ts-new',pg_temp.today()+1400));
select pg_temp.assert_true(pg_temp.permit_alerts('expired')=0,'Expired récépissés need no renewal once the new card is filed');
select pg_temp.assert_true(pg_temp.permit_alerts('expiring')=0,'A récépissé still running is not chased when a later card exists');
-- The rule is limited to residence permits: an expired CNI still alerts beside a valid passport.
select public.register_document(pg_temp.permit('CNI','cni-old',pg_temp.today()-10));
select public.register_document(pg_temp.permit('PASSPORT','pass-ok',pg_temp.today()+3000));
select pg_temp.assert_true((select count(*) from public.document_alerts where person_id='42000000-0000-4000-8000-000000000004' and severity='expired' and type_code='CNI')=1,'Identity documents keep their own expiry alerts');
-- Company documents: admins file and renew them, HR never sees them, the
-- registry keeps them ownerless, and their expiry raises an alert.
select pg_temp.as_user('41000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.register_document(jsonb_build_object('owner_kind','company','type_code','COMPANY_KBIS','title','Kbis',
 'storage_provider','gdrive','provider_file_id','kbis-1','file_name','kbis.pdf','expires_on',pg_temp.today()+5));
select pg_temp.assert_true(pg_temp.alerts('expiring','COMPANY_KBIS')=1,'A Kbis expiring within 15 days alerts');
select public.register_document(jsonb_build_object('owner_kind','company','type_code','COMPANY_KBIS','title','Kbis',
 'storage_provider','gdrive','provider_file_id','kbis-2','file_name','kbis.pdf','expires_on',pg_temp.today()+90),
 (select id from public.documents where provider_file_id='kbis-1'));
select pg_temp.assert_true(pg_temp.alerts('expiring','COMPANY_KBIS')=0,'Renewing the Kbis clears its alert');
select public.register_document(jsonb_build_object('owner_kind','company','type_code','ANNUAL_ACCOUNTS','title','Bilan 2025',
 'storage_provider','gdrive','provider_file_id','bilan-2025','file_name','bilan.pdf','valid_from','2025-01-01'));
select pg_temp.assert_true((select count(*) from public.documents where owner_kind='company' and status='active')=2,'Admins read company documents');
do $$ begin
 begin
  perform public.register_document(jsonb_build_object('owner_kind','company','type_code','RIB','title','x',
   'storage_provider','gdrive','provider_file_id','company-rib','file_name','x.pdf'));
  raise exception 'FAILED: person type accepted on the company';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
 begin
  perform public.register_document(jsonb_build_object('owner_kind','company','person_id','42000000-0000-4000-8000-000000000001',
   'type_code','COMPANY_OTHER','title','x','storage_provider','gdrive','provider_file_id','company-owned','file_name','x.pdf'));
  raise exception 'FAILED: company document attached to a person';
 exception when check_violation then null; end;
end; $$;
insert into public.document_folders(storage_provider,owner_kind,owner_id,folder_code,provider_folder_id)
 values('gdrive','company','00000000-0000-4000-8000-00000000c0de','','company-root');
reset role;
select pg_temp.as_user('41000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.documents where owner_kind='company')=0,'HR does not read company documents');
select pg_temp.assert_true((select count(*) from public.document_folders where owner_kind='company')=0,'HR does not read company folders');
do $$ begin
 begin
  perform public.register_document(jsonb_build_object('owner_kind','company','type_code','COMPANY_OTHER','title','x',
   'storage_provider','gdrive','provider_file_id','hr-company','file_name','x.pdf'));
  raise exception 'FAILED: HR registered a company document';
 exception when raise_exception then if sqlerrm like 'FAILED%' then raise; end if; end;
end; $$;
reset role;
rollback;
