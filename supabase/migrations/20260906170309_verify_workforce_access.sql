-- Transactional regression check; fixtures roll back even when every assertion passes.
do $verify$
begin
 begin
insert into auth.users(id, email, raw_user_meta_data) values
('10000000-0000-4000-8000-000000000001','rls-candidate-a@example.invalid','{"role":"admin","full_name":"Candidate A"}'),
('10000000-0000-4000-8000-000000000002','rls-candidate-b@example.invalid','{}'),
('10000000-0000-4000-8000-000000000003','rls-admin@example.invalid','{}');
update public.user_roles set role='admin' where user_id='10000000-0000-4000-8000-000000000003';
insert into public.jobs(id,slug,title,location,description,linkedin_url,published) values
('20000000-0000-4000-8000-000000000001','rls-public-job','Public role','Paris','Test','https://www.linkedin.com/jobs/view/123',true),
('20000000-0000-4000-8000-000000000002','rls-draft-job','Draft role','Paris','Test','https://www.linkedin.com/jobs/view/123',false);
insert into public.contracts(id,candidate_id,title,storage_path,document_sha256) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','A contract','10000000-0000-4000-8000-000000000001/contract.pdf',repeat('a',64)),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','B contract','10000000-0000-4000-8000-000000000002/contract.pdf',repeat('b',64));
insert into storage.objects(bucket_id,name) values
('contracts','10000000-0000-4000-8000-000000000001/contract.pdf'),
('contracts','10000000-0000-4000-8000-000000000002/contract.pdf');
set local role anon;
do $$ declare denied boolean:=false; begin
 if (select count(*) from public.jobs where slug like 'rls-%')<>1 then raise exception 'Anon can see a draft'; end if;
 begin perform * from public.profiles; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon can read profiles'; end if;
end $$;
reset role;
perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare denied boolean; begin
 if (select role from public.user_roles where user_id=auth.uid())<>'candidate' then raise exception 'User metadata granted admin'; end if;
 if (select count(*) from public.profiles where id::text like '10000000-%')<>1 then raise exception 'Cross-candidate profile leak'; end if;
 if (select count(*) from public.contracts where id::text like '30000000-%')<>1 then raise exception 'Cross-candidate contract leak'; end if;
 if (select count(*) from storage.objects where bucket_id='contracts' and name like '10000000-%')<>1 then raise exception 'Cross-candidate storage leak'; end if;
 denied:=false; begin update public.user_roles set role='admin' where user_id=auth.uid(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate changed role'; end if;
 denied:=false; begin insert into public.jobs(slug,title,location,description,linkedin_url) values('rls-forbidden','Forbidden','Paris','Test','https://linkedin.com/jobs/1'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate created a job'; end if;
 denied:=false; begin insert into public.candidate_documents(candidate_id,name,category,storage_path,size_bytes) values('10000000-0000-4000-8000-000000000002','wrong.pdf','other','10000000-0000-4000-8000-000000000002/wrong.pdf',20); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate assigned document to another'; end if;
 denied:=false; begin insert into storage.objects(bucket_id,name) values('candidate-documents','10000000-0000-4000-8000-000000000002/wrong.pdf'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate uploaded into another folder'; end if;
 denied:=false; begin insert into public.contract_signatures(contract_id,signer_name) values('30000000-0000-4000-8000-000000000002','Wrong person'); exception when others then denied:=true; end;
 if not denied then raise exception 'Candidate signed someone else contract'; end if;
 insert into public.contract_signatures(contract_id,signer_name) values('30000000-0000-4000-8000-000000000001','Candidate A');
 if not exists(select 1 from public.contract_signatures where candidate_id=auth.uid() and document_sha256=repeat('a',64) and signed_at=now()) then raise exception 'Signature not stamped by server'; end if;
 denied:=false; begin update public.contract_signatures set signer_name='Tampered'; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Signature mutated'; end if;
 insert into public.tool_requests(tool_name,reason) values('RLS Tool','Test access');
 denied:=false; begin insert into public.tool_requests(tool_name,reason,status) values('RLS Tool','Test','approved'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate self-approved request'; end if;
 update public.tool_requests set status='approved' where tool_name='RLS Tool';
 if exists(select 1 from public.tool_requests where tool_name='RLS Tool' and status<>'pending') then raise exception 'Candidate changed request status'; end if;
end $$;
reset role;
perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.jobs where slug like 'rls-%')<>2 then raise exception 'Admin cannot read drafts'; end if;
 update public.jobs set published=true where slug='rls-draft-job';
 if not exists(select 1 from public.jobs where slug='rls-draft-job' and published) then raise exception 'Admin publish failed'; end if;
 update public.tool_requests set status='approved' where tool_name='RLS Tool';
 if not exists(select 1 from public.tool_requests where tool_name='RLS Tool' and status='approved') then raise exception 'Admin approval failed'; end if;
 begin
 delete from storage.objects where bucket_id='contracts' and name='10000000-0000-4000-8000-000000000001/contract.pdf';
 exception when insufficient_privilege then null;
 end;
 if not exists(select 1 from storage.objects where bucket_id='contracts' and name='10000000-0000-4000-8000-000000000001/contract.pdf') then raise exception 'Admin deleted signed contract'; end if;
 delete from public.jobs where slug='rls-public-job';
 if exists(select 1 from public.jobs where slug='rls-public-job') then raise exception 'Admin deletion failed'; end if;
end $$;

 raise exception using errcode = 'ZX001', message = 'Checks passed; discard fixtures';
 exception when sqlstate 'ZX001' then null;
 end;
end $verify$;
