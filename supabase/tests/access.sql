-- Run in the Supabase SQL editor or via execute_sql. Every fixture is rolled back.
begin;
insert into auth.users(id, email, raw_user_meta_data) values
('10000000-0000-4000-8000-000000000001','rls-candidate-a@example.invalid','{"role":"admin","full_name":"Candidate A"}'),
('10000000-0000-4000-8000-000000000002','rls-candidate-b@example.invalid','{}'),
('10000000-0000-4000-8000-000000000003','rls-admin@example.invalid','{}');
update public.user_roles set role='admin' where user_id='10000000-0000-4000-8000-000000000003';
insert into public.jobs(id,slug,title,location,description,linkedin_url,published) values
('20000000-0000-4000-8000-000000000001','rls-public-job','Public role','Paris','Test','https://www.linkedin.com/jobs/view/123',true),
('20000000-0000-4000-8000-000000000002','rls-draft-job','Draft role','Paris','Test','https://www.linkedin.com/jobs/view/123',false);
insert into public.hr_people(id,full_name,email) values
('30000000-0000-4000-8000-000000000001','Candidate A','rls-candidate-a@example.invalid');
insert into public.signature_requests(id,person_id,title,type_code,signers,status,created_by) values
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','A contract','EMPLOYMENT_CONTRACT','[]','sent','10000000-0000-4000-8000-000000000003');
set local role anon;
do $$ declare denied boolean:=false; begin
 if (select count(*) from public.jobs where slug like 'rls-%')<>1 then raise exception 'Anon can see a draft'; end if;
 begin perform * from public.profiles; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon can read profiles'; end if;
 denied:=false; begin perform * from public.signature_requests; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon can read signature requests'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare denied boolean; begin
 if (select role from public.user_roles where user_id=auth.uid())<>'candidate' then raise exception 'User metadata granted admin'; end if;
 if (select count(*) from public.profiles where id::text like '10000000-%')<>1 then raise exception 'Cross-candidate profile leak'; end if;
 if (select count(*) from public.signature_requests where id::text like '31000000-%')<>0 then raise exception 'Non-admin can read signature requests'; end if;
 denied:=false; begin update public.user_roles set role='admin' where user_id=auth.uid(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate changed role'; end if;
 denied:=false; begin insert into public.jobs(slug,title,location,description,linkedin_url) values('rls-forbidden','Forbidden','Paris','Test','https://linkedin.com/jobs/1'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate created a job'; end if;
 denied:=false; begin insert into public.candidate_documents(candidate_id,name,category,storage_path,size_bytes) values('10000000-0000-4000-8000-000000000002','wrong.pdf','other','10000000-0000-4000-8000-000000000002/wrong.pdf',20); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate assigned document to another'; end if;
 denied:=false; begin insert into storage.objects(bucket_id,name) values('candidate-documents','10000000-0000-4000-8000-000000000002/wrong.pdf'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate uploaded into another folder'; end if;
 insert into public.tool_requests(tool_name,reason) values('RLS Tool','Test access');
 denied:=false; begin insert into public.tool_requests(tool_name,reason,status) values('RLS Tool','Test','approved'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Candidate self-approved request'; end if;
 update public.tool_requests set status='approved' where tool_name='RLS Tool';
 if exists(select 1 from public.tool_requests where tool_name='RLS Tool' and status<>'pending') then raise exception 'Candidate changed request status'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.jobs where slug like 'rls-%')<>2 then raise exception 'Admin cannot read drafts'; end if;
 update public.jobs set published=true where slug='rls-draft-job';
 if not exists(select 1 from public.jobs where slug='rls-draft-job' and published) then raise exception 'Admin publish failed'; end if;
 update public.tool_requests set status='approved' where tool_name='RLS Tool';
 if not exists(select 1 from public.tool_requests where tool_name='RLS Tool' and status='approved') then raise exception 'Admin approval failed'; end if;
 if (select count(*) from public.signature_requests where id::text like '31000000-%')<>1 then raise exception 'Admin cannot read signature requests'; end if;
 delete from public.jobs where slug='rls-public-job';
 if exists(select 1 from public.jobs where slug='rls-public-job') then raise exception 'Admin deletion failed'; end if;
end $$;
rollback;
select 'PASS: anonymous access, candidate isolation, role protection, admin-only signature requests, storage, admin publishing and request decisions' as result;
