begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('31000000-0000-4000-8000-000000000001','inv-admin@example.invalid','{}'),
 ('31000000-0000-4000-8000-000000000002','inv-employee@example.invalid','{}'),
 ('31000000-0000-4000-8000-000000000003','inv-hr@example.invalid','{}');
update public.user_roles set role='admin' where user_id='31000000-0000-4000-8000-000000000001';
update public.user_roles set role='hr' where user_id='31000000-0000-4000-8000-000000000003';
insert into public.hr_people(id,full_name,email) values
 ('32000000-0000-4000-8000-000000000001','Invoice Employee','inv-employee@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('31000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status) values
 ('33000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','2026-01-01','active');
insert into public.sales_clients(id,name) values('34000000-0000-4000-8000-000000000001','Invoice Client');
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price) values
 ('35000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','Regie project','forfait',50000);
insert into public.employee_project_assignments(employee_id,project_id,start_date,end_date,status,allocation_pct) values
 ('33000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001','2026-11-01','2026-11-30','active',100);
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.save(version integer) returns jsonb language sql as $$
 select public.cra_save_month('33000000-0000-4000-8000-000000000001','2026-11-01',version,'[{"day":"2026-11-02","status":"internal","project_id":null}]');
$$;
create function pg_temp.add_invoice(invoice_status text, number text) returns void language sql as $$
 insert into public.invoices(provider,provider_invoice_id,number,status,source,project_id,billed_client_id,employee_id,period_month)
 values('qonto',number,number,invoice_status,'cra','35000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','2026-11-01');
$$;

-- RLS: employees see nothing and write nothing.
select pg_temp.add_invoice('draft','INV-1');
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.invoices)=0,'Employee cannot see invoices');
select pg_temp.assert_true((select count(*) from public.invoice_lines)=0,'Employee cannot see invoice lines');
do $$ begin
 begin
  insert into public.invoices(provider,status,source) values('qonto','draft','imported');
  raise exception 'FAILED: Employee inserted an invoice';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.invoices)=1,'Admin sees invoices through RLS');
reset role;

-- Draft does not lock the CRA.
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true(not private.cra_invoiced('33000000-0000-4000-8000-000000000001','2026-11-01'),'Draft invoice is not locked');
select pg_temp.assert_true((pg_temp.save(0)->>'version')::integer=1,'Employee saves while only a draft exists');
select pg_temp.assert_true((public.cra_month_snapshot('33000000-0000-4000-8000-000000000001','2026-11-01')->>'invoiced')='false','Snapshot reports not invoiced');

-- One live CRA invoice per consultant, project and month.
do $$ begin
 begin
  perform pg_temp.add_invoice('draft','INV-2');
  raise exception 'FAILED: Duplicate CRA invoice allowed';
 exception when unique_violation then null; end;
end; $$;
update public.invoices set status='canceled' where number='INV-1';
select pg_temp.add_invoice('draft','INV-2');

-- Finalized invoice locks the month for employees only.
update public.invoices set status='finalized' where number='INV-2';
select pg_temp.assert_true(private.cra_invoiced('33000000-0000-4000-8000-000000000001','2026-11-01'),'Finalized invoice locks the month');
select pg_temp.assert_true((public.cra_month_snapshot('33000000-0000-4000-8000-000000000001','2026-11-01')->>'invoiced')='true','Snapshot reports invoiced');
do $$ begin
 begin
  perform pg_temp.save(1);
  raise exception 'FAILED: Employee saved a locked month';
 exception when others then if sqlerrm not like '%invoiced and is locked%' then raise; end if; end;
end; $$;
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true((pg_temp.save(1)->>'version')::integer=2,'Admin saves a locked month');
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert_true((pg_temp.save(2)->>'version')::integer=3,'HR saves a locked month');
update public.invoices set status='paid' where number='INV-2';
select pg_temp.assert_true(private.cra_invoiced('33000000-0000-4000-8000-000000000001','2026-11-01'),'Paid invoice keeps the lock');
rollback;
