begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('31000000-0000-4000-8000-000000000001','pc-admin@example.invalid','{}'),
 ('31000000-0000-4000-8000-000000000002','pc-employee@example.invalid','{}');
update public.user_roles set role='admin' where user_id='31000000-0000-4000-8000-000000000001';
insert into public.hr_people(id,full_name,email) values
 ('32000000-0000-4000-8000-000000000001','PC Employee','pc-employee@example.invalid'),
 ('32000000-0000-4000-8000-000000000002','PC Other','pc-other@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('31000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status) values
 ('33000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','2025-01-01','active'),
 ('33000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000002','2025-01-01','active');
insert into public.sales_clients(id,name) values('34000000-0000-4000-8000-000000000001','PC Client');
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price) values
 ('35000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','PC project','forfait',10000);
-- Employee 1: Senior line in H1, Lead line from July. Employee 2: cancelled, so no line.
insert into public.employee_project_assignments(employee_id,project_id,start_date,end_date,status,allocation_pct,pricing_line) values
 ('33000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001','2025-01-01','2026-06-30','confirmed',100,'Senior'),
 ('33000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001','2026-07-01',null,'active',100,'Lead'),
 ('33000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000001','2026-01-01',null,'cancelled',100,'Senior');
insert into public.cra_months(employee_id,month) values
 ('33000000-0000-4000-8000-000000000001','2025-12-01'),
 ('33000000-0000-4000-8000-000000000001','2026-03-01'),
 ('33000000-0000-4000-8000-000000000001','2026-07-01'),
 ('33000000-0000-4000-8000-000000000002','2026-03-01');
insert into public.cra_entries(employee_id,month,day,part,status,project_id) values
 ('33000000-0000-4000-8000-000000000001','2025-12-01','2025-12-15','full','client_project','35000000-0000-4000-8000-000000000001'),
 ('33000000-0000-4000-8000-000000000001','2026-03-01','2026-03-02','full','client_project','35000000-0000-4000-8000-000000000001'),
 ('33000000-0000-4000-8000-000000000001','2026-03-01','2026-03-03','am','client_project','35000000-0000-4000-8000-000000000001'),
 ('33000000-0000-4000-8000-000000000001','2026-03-01','2026-03-04','full','internal',null),
 ('33000000-0000-4000-8000-000000000001','2026-07-01','2026-07-01','pm','client_project','35000000-0000-4000-8000-000000000001'),
 ('33000000-0000-4000-8000-000000000002','2026-03-01','2026-03-02','full','client_project','35000000-0000-4000-8000-000000000001');
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.project_days(result jsonb) returns numeric language sql as $$
 select coalesce((select (p->>'days')::numeric from jsonb_array_elements(result->'projects') p where p->>'project_id'='35000000-0000-4000-8000-000000000001'),0);
$$;
create function pg_temp.line_days(result jsonb, line text) returns numeric language sql as $$
 select coalesce((select (l->>'days')::numeric from jsonb_array_elements(result->'lines') l where l->>'project_id'='35000000-0000-4000-8000-000000000001' and l->>'pricing_line'=line),0);
$$;

-- Admin reads every employee's CRA.
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table admin_result as select public.sales_project_cra_consumption(2026) as r;
reset role;
select pg_temp.assert_true(pg_temp.project_days(r)=4,'All-time days count full=1 and am/pm=0.5 across employees and years') from admin_result;
select pg_temp.assert_true(pg_temp.line_days(r,'Senior')=1.5,'Current-year Senior days come from the covering assignment only') from admin_result;
select pg_temp.assert_true(pg_temp.line_days(r,'Lead')=0.5,'A day after the line switch attributes to the new line') from admin_result;
select pg_temp.assert_true(jsonb_array_length(r->'lines')=2,'Cancelled assignments and other years carry no line days') from admin_result;

-- An employee only sees totals of their own entries, like cra_entries RLS.
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
create temp table employee_result as select public.sales_project_cra_consumption(2026) as r;
reset role;
select pg_temp.assert_true(pg_temp.project_days(r)=3,'Employee totals exclude other employees') from employee_result;

select pg_temp.assert_true(not has_function_privilege('anon','public.sales_project_cra_consumption(integer)','execute'),'Anonymous callers are denied');
rollback;
