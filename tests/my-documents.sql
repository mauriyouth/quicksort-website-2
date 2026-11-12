begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('61000000-0000-4000-8000-000000000001','md-hr@example.invalid','{}'),
 ('61000000-0000-4000-8000-000000000002','md-employee@example.invalid','{}'),
 ('61000000-0000-4000-8000-000000000003','md-other@example.invalid','{}');
update public.user_roles set role='hr' where user_id='61000000-0000-4000-8000-000000000001';
insert into public.hr_people(id,full_name,email) values
 ('62000000-0000-4000-8000-000000000001','Upload Person A','md-a@example.invalid'),
 ('62000000-0000-4000-8000-000000000002','Upload Person B','md-b@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),
 ('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001');
-- Uploads register in the registry through the candidate_documents trigger.
insert into public.candidate_documents(candidate_id,name,category,storage_path,size_bytes) values
 ('61000000-0000-4000-8000-000000000002','id.pdf','identity','61000000-0000-4000-8000-000000000002/id.pdf',10),
 ('61000000-0000-4000-8000-000000000002','cv.pdf','resume','61000000-0000-4000-8000-000000000002/cv.pdf',10),
 ('61000000-0000-4000-8000-000000000003','other.pdf','identity','61000000-0000-4000-8000-000000000003/other.pdf',10);
-- HR-filed documents on the same person: an active one, an archived one, a payslip.
insert into public.documents(id,type_code,owner_kind,person_id,title,status,valid_from,storage_provider,provider_file_id,file_name,uploaded_by,notes) values
 ('63000000-0000-4000-8000-000000000001','OTHER','person','62000000-0000-4000-8000-000000000001','Attestation','active',null,'gdrive','md-hr-file','attestation.pdf','61000000-0000-4000-8000-000000000001','HR-only remark'),
 ('63000000-0000-4000-8000-000000000002','OTHER','person','62000000-0000-4000-8000-000000000001','Old attestation','archived',null,'gdrive','md-hr-old','old.pdf','61000000-0000-4000-8000-000000000001',''),
 ('63000000-0000-4000-8000-000000000003','PAYSLIP','person','62000000-0000-4000-8000-000000000001','Bulletin','active','2026-09-01','gdrive','md-hr-payslip','payslip.pdf','61000000-0000-4000-8000-000000000001',''),
 ('63000000-0000-4000-8000-000000000004','OTHER','person','62000000-0000-4000-8000-000000000002','Other person file','active',null,'gdrive','md-other','x.pdf','61000000-0000-4000-8000-000000000001','');
insert into public.google_drive_settings(id,encrypted_credentials) values ('default','cipher-text') on conflict (id) do update set encrypted_credentials=excluded.encrypted_credentials;

create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
 begin execute statement; return false; exception when others then return true; end;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true);
$$;

select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.my_documents)=2,'Employee sees their HR folder: own upload and the active HR file, no payslip, no archived HR file, nobody else');
select pg_temp.assert_true((select upload_path='61000000-0000-4000-8000-000000000002/id.pdf' and uploaded_by_me and needs_review and status='active' from public.my_documents where upload_path is not null),'The upload maps back to its storage path and awaits classification');
select pg_temp.assert_true((select upload_path is null and not uploaded_by_me and title='Attestation' from public.my_documents where id='63000000-0000-4000-8000-000000000001'),'HR-filed document is listed as added by HR, without a storage path');
select pg_temp.assert_true((select count(*) from public.own_document_download_source('63000000-0000-4000-8000-000000000001') where provider_file_id='md-hr-file' and encrypted_credentials='cipher-text')=1,'HR-filed document of their own folder is downloadable');
select pg_temp.assert_true((select count(*) from public.own_document_download_source('63000000-0000-4000-8000-000000000002'))=0,'Archived HR file is not downloadable');
select pg_temp.assert_true((select count(*) from public.own_document_download_source('63000000-0000-4000-8000-000000000003'))=0,'Payslips go through their own action');
select pg_temp.assert_true((select count(*) from public.own_document_download_source('63000000-0000-4000-8000-000000000004'))=0,'Another person document is not downloadable');
select pg_temp.assert_true((select count(*) from public.documents)=0,'Registry RLS is unchanged for employees');
reset role;

-- HR classifies it: the employee sees the new type and expiry.
update public.documents set type_code='PASSPORT', needs_review=false, expires_on='2030-01-01'
 where provider_file_id='candidate-documents/61000000-0000-4000-8000-000000000002/id.pdf';
select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select type_code='PASSPORT' and not needs_review and expires_on='2030-01-01' and cardinality(warn_days)>0 from public.my_documents where upload_path is not null),'Classification is visible to the employee');
reset role;
select pg_temp.assert_true((select count(*) from public.hr_events where kind='document_accessed' and actor_id='61000000-0000-4000-8000-000000000002')=1,'Only the granted download is audited');

select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.my_documents)=0,'HR has no uploads of their own here');
reset role;
-- The checklist: requirements of the not-ended employment, plus a residence permit outside the EU.
insert into public.employees(id,person_id,start_date,end_date,status,contract_type,nationality) values
 ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','2026-01-01',null,'active','CDI','MA'),
 ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','2020-01-01','2020-12-31','ended','Freelance','');
select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_true((select bool_and(required) from public.my_document_types where code in ('CNI','PASSPORT','CARTE_VITALE','RIB','EMPLOYMENT_CONTRACT','TITRE_SEJOUR')),'CDI and non-EU requirements apply to the employee');
select pg_temp.assert_true((select not bool_or(required) from public.my_document_types where code in ('KBIS','FREELANCE_CONTRACT','DIPLOMA')),'Freelance-only and optional types are not required');
select pg_temp.assert_true((select count(*) from public.my_document_types where code='PAYSLIP')=0,'Payslips are not part of the folder types');
select pg_temp.assert_true((select bool_and(relevant) from public.my_document_types where code in ('CNI','TITRE_SEJOUR','CARTE_VITALE','DIPLOMA','JUSTIF_DOMICILE','TRANSPORT_PASS')),'Contract documents and general ones are offered');
select pg_temp.assert_true((select not bool_or(relevant) from public.my_document_types where code in ('KBIS','URSSAF_VIGILANCE','RC_PRO')),'Freelance company documents are not offered to a salaried employee');
select pg_temp.assert_true((select not self_upload from public.my_document_types where code='EMPLOYMENT_CONTRACT') and (select self_upload from public.my_document_types where code='CARTE_VITALE'),'Contracts stay HR-filed; the employee files their own papers');
select pg_temp.assert_true((select not self_upload from public.my_document_types where code='PROBATION_LETTER'),'The probation letter is HR-filed (signed through Youtrust), not self-uploaded');
-- An upload made for a slot is registered under that type, still for HR to verify.
insert into public.candidate_documents(candidate_id,name,category,type_code,storage_path,size_bytes) values
 ('61000000-0000-4000-8000-000000000002','vitale.pdf','other','CARTE_VITALE','61000000-0000-4000-8000-000000000002/vitale.pdf',10);
select pg_temp.assert_true((select type_code='CARTE_VITALE' and title='Carte Vitale' and needs_review from public.my_documents where upload_path='61000000-0000-4000-8000-000000000002/vitale.pdf'),'Typed upload lands in its slot, awaiting HR verification');
select pg_temp.assert_true(pg_temp.rejects($q$insert into public.candidate_documents(candidate_id,name,category,type_code,storage_path,size_bytes) values ('61000000-0000-4000-8000-000000000002','c.pdf','other','EMPLOYMENT_CONTRACT','61000000-0000-4000-8000-000000000002/c.pdf',10)$q$),'An employee cannot file a contract');
reset role;
select pg_temp.as_user('61000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.my_document_types where required)=0,'An ended employment requires nothing');
select pg_temp.assert_true((select bool_and(relevant) from public.my_document_types where code in ('CNI','CARTE_VITALE','DIPLOMA')) and (select not bool_or(relevant) from public.my_document_types where code in ('TITRE_SEJOUR','KBIS')),'Without a current employment: salaried and general documents, no residence permit or Kbis');
reset role;
rollback;
