insert into auth.users(id,email,raw_user_meta_data)
values('13000000-0000-4000-8000-000000000001','upgrade-admin@example.invalid','{}');
update public.user_roles set role='admin' where user_id='13000000-0000-4000-8000-000000000001';

insert into public.pipeline_candidates(id,full_name,email,notes,person_status,stage) values
 ('13000000-0000-4000-8000-000000000002','Dated Employee','dated@example.invalid','Original candidate notes','employee','confirmed'),
 ('13000000-0000-4000-8000-000000000003','Undated Employee','undated@example.invalid','Original missing-date notes','employee','confirmed'),
 ('13000000-0000-4000-8000-000000000004','Talent Person','talent@example.invalid','Talent notes','candidate','application');
insert into public.employees(id,candidate_id,full_name,email,role,notes,stage,status,start_date,probation_end) values
 ('13000000-0000-4000-8000-000000000005','13000000-0000-4000-8000-000000000002','Dated Employee','dated@example.invalid','Engineer','Updated employee notes','confirmed','employee','2020-01-15','2020-04-15'),
 ('13000000-0000-4000-8000-000000000006','13000000-0000-4000-8000-000000000003','Undated Employee','undated@example.invalid','Designer','Employee without a source date','confirmed','employee',null,null);
insert into public.pipeline_events(candidate_id,from_stage,to_stage,actor_email,rationale) values
 ('13000000-0000-4000-8000-000000000002','probation','confirmed','upgrade-admin@example.invalid','Known actor decision'),
 ('13000000-0000-4000-8000-000000000003','probation','confirmed','former-actor@example.invalid','Former actor decision');
insert into public.candidate_requests(id,email,kind,message)
values('13000000-0000-4000-8000-000000000009','talent@example.invalid','human_review','Keep this request');
insert into public.sales_clients(id,name,notes)
values('13000000-0000-4000-8000-000000000007','Existing client','Keep sales data');
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price)
values('13000000-0000-4000-8000-000000000008','13000000-0000-4000-8000-000000000007','Existing project','forfait',1000);
