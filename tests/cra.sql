begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('21000000-0000-4000-8000-000000000001','cra-admin@example.invalid','{}'),
 ('21000000-0000-4000-8000-000000000002','cra-employee@example.invalid','{}'),
 ('21000000-0000-4000-8000-000000000003','cra-other@example.invalid','{}'),
 ('21000000-0000-4000-8000-000000000004','cra-sales@example.invalid','{}');
update public.user_roles set role='admin' where user_id='21000000-0000-4000-8000-000000000001';
update public.user_roles set role='sales' where user_id='21000000-0000-4000-8000-000000000004';
insert into public.hr_people(id,full_name,email) values
 ('22000000-0000-4000-8000-000000000001','CRA Employee','cra-employee@example.invalid'),
 ('22000000-0000-4000-8000-000000000002','Other Employee','cra-other@example.invalid');
insert into public.hr_person_accounts(profile_id,person_id,linked_by) values
 ('21000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001');
insert into public.employees(id,person_id,start_date,status) values
 ('23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','2026-10-02','active'),
 ('23000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','2026-01-01','active');
insert into public.sales_clients(id,name) values('24000000-0000-4000-8000-000000000001','CRA Client');
insert into public.sales_projects(id,client_id,title,pricing_model,fixed_price) values
 ('25000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Assigned project','forfait',50000),
 ('25000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','Other project','forfait',75000);
insert into public.employee_project_assignments(employee_id,project_id,start_date,end_date,status,allocation_pct) values
 ('23000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','2026-10-05','2026-10-16','active',100);
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
 begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.save(entries jsonb, version integer default 0, employee uuid default '23000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.cra_save_month(employee,'2026-10-01',version,entries);
$$;
create function pg_temp.must_fail(entries jsonb, expected text, version integer default 0, employee uuid default '23000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
 declare failed boolean:=false; previous jsonb;
 begin
  select jsonb_agg(to_jsonb(e) order by e.day) into previous from public.cra_entries e;
  begin perform pg_temp.save(entries,version,employee); exception when others then
   if position(lower(expected) in lower(sqlerrm))=0 then raise exception 'Unexpected failure: % (wanted %)',sqlerrm,expected; end if;
   failed:=true;
  end;
  perform pg_temp.assert_true(failed,'Expected CRA rejection: '||expected);
  perform pg_temp.assert_true((select jsonb_agg(to_jsonb(e) order by e.day) from public.cra_entries e) is not distinct from previous,'Failed save preserves all entries');
 end;
$$;
select set_config('request.jwt.claims','{"sub":"21000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true(jsonb_array_length(public.cra_context()->'employees')=1,'Employee context is scoped to linked employment');
select pg_temp.assert_true(jsonb_array_length(public.cra_context()->'assignments')=1,'Employee only sees assigned project metadata');
select pg_temp.assert_true(not((public.cra_context()->'assignments'->0) ? 'fixed_price'),'Project financial data is excluded');
select pg_temp.must_fail('[{"day":"2026-10-01","status":"internal","project_id":null}]','employment period');
select pg_temp.must_fail('[{"day":"2026-11-02","status":"internal","project_id":null}]','selected month');
select pg_temp.must_fail('[{"day":"2026-10-02","status":"holiday","project_id":null}]','valid CRA status');
select pg_temp.must_fail('[{"day":"2026-10-02","status":"internal","project_id":null},{"day":"2026-10-02","status":"rtt","project_id":null}]','one entry');
select pg_temp.must_fail('[{"day":"2026-10-05","status":"client_project","project_id":null}]','require a project');
select pg_temp.must_fail('[{"day":"2026-10-05","status":"internal","project_id":"25000000-0000-4000-8000-000000000001"}]','require a project');
select pg_temp.must_fail('[{"day":"2026-10-05","status":"client_project","project_id":"25000000-0000-4000-8000-000000000002"}]','assigned');
select pg_temp.must_fail('[{"day":"2026-10-17","status":"client_project","project_id":"25000000-0000-4000-8000-000000000001"}]','assigned');
select pg_temp.must_fail('[]','cannot edit',0,'23000000-0000-4000-8000-000000000002');
select pg_temp.assert_true((pg_temp.save('[{"day":"2026-10-02","status":"internal","project_id":null},{"day":"2026-10-05","status":"client_project","project_id":"25000000-0000-4000-8000-000000000001"},{"day":"2026-10-06","status":"rtt","project_id":null},{"day":"2026-10-07","status":"paid_leave","project_id":null},{"day":"2026-10-08","status":"unpaid_leave","project_id":null}]')->>'version')::integer=1,'Employee saves all five activities');
select pg_temp.must_fail('[]','another person');
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.cra_entries)=5,'Employee reads own entries through RLS');
reset role;
select set_config('request.jwt.claims','{"sub":"21000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert_true(jsonb_array_length(public.cra_context()->'employees')=0,'Unlinked user gets no employees');
select pg_temp.must_fail('[]','cannot edit',1);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.cra_entries)=0,'Other user cannot read CRA rows');
do $$ begin
 begin perform public.cra_month_snapshot('23000000-0000-4000-8000-000000000001','2026-10-01'); raise exception 'FAILED: Other user read employee CRA';
 exception when others then if sqlerrm not like '%cannot access%' then raise; end if; end;
 begin delete from public.cra_entries; raise exception 'FAILED: Direct delete allowed';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"21000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.assert_true(jsonb_array_length(public.cra_context()->'employees')=0,'Sales cannot browse employee CRA');
select set_config('request.jwt.claims','{"sub":"21000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.cra_context()->'employees')=2,'Admin can select every employee');
select pg_temp.assert_true((public.cra_save_month('23000000-0000-4000-8000-000000000001','2026-10-01',1,'[{"day":"2026-10-02","status":"rtt","project_id":null}]')->>'updated_by')='cra-admin@example.invalid','Admin saves on employee behalf and records editor');
select pg_temp.assert_true(jsonb_array_length(pg_temp.save('[{"day":"2026-10-12","part":"am","status":"internal","project_id":null},{"day":"2026-10-12","part":"pm","status":"rtt","project_id":null}]',2)->'entries')=2,'A morning and an afternoon fit on the same day');
select pg_temp.assert_true((public.cra_month_snapshot('23000000-0000-4000-8000-000000000001','2026-10-01')->'entries'->0) ? 'part','Snapshot exposes the entry part');
select pg_temp.must_fail('[{"day":"2026-10-13","status":"internal","project_id":null},{"day":"2026-10-13","part":"pm","status":"rtt","project_id":null}]','mix a full day',3);
select pg_temp.must_fail('[{"day":"2026-10-13","part":"am","status":"internal","project_id":null},{"day":"2026-10-13","part":"am","status":"rtt","project_id":null}]','one entry per day and part',3);
select pg_temp.must_fail('[{"day":"2026-10-13","part":"evening","status":"internal","project_id":null}]','valid entry part',3);
select pg_temp.assert_true(jsonb_array_length(public.cra_month_snapshot('23000000-0000-4000-8000-000000000001','2026-11-01')->'entries')=0,'Months have independent entries');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.cra_save_month(uuid,date,integer,jsonb)','execute'),'Anonymous save is denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.cra_context()','execute'),'Anonymous context is denied');
rollback;
