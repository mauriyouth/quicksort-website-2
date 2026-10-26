begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('11000000-0000-4000-8000-000000000001','hr@example.invalid','{}'),
 ('11000000-0000-4000-8000-000000000002','candidate@example.invalid','{}'),
 ('11000000-0000-4000-8000-000000000003','other@example.invalid','{}'),
 ('11000000-0000-4000-8000-000000000004','admin@example.invalid','{}'),
 ('11000000-0000-4000-8000-000000000005','sales@example.invalid','{}');
update public.user_roles set role='hr' where user_id='11000000-0000-4000-8000-000000000001';
update public.user_roles set role='admin' where user_id='11000000-0000-4000-8000-000000000004';
update public.user_roles set role='sales' where user_id='11000000-0000-4000-8000-000000000005';
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

create function pg_temp.command(payload jsonb) returns jsonb language sql as $$
 select public.hr_command(jsonb_build_object('request_id',gen_random_uuid())||payload)
$$;
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
begin if actual is distinct from true then raise exception 'FAILED: %',description; end if; end;
$$;
create function pg_temp.must_fail(payload jsonb, expected_message text) returns void language plpgsql as $$
declare failed boolean:=false; before_events bigint; before_receipts bigint;
begin
 select count(*) into before_events from public.hr_events;
 select count(*) into before_receipts from public.hr_command_receipts;
 begin perform pg_temp.command(payload); exception when others then
  if position(lower(expected_message) in lower(sqlerrm))=0 then raise exception 'Unexpected failure: % (wanted %)',sqlerrm,expected_message; end if;
  failed:=true;
 end;
 perform pg_temp.assert_true(failed,'Expected command rejection: '||expected_message);
 perform pg_temp.assert_true((select count(*) from public.hr_events)=before_events,'Failed command leaves no audit event');
 perform pg_temp.assert_true((select count(*) from public.hr_command_receipts)=before_receipts,'Failed command leaves no receipt');
end;
$$;
create function pg_temp.move(app uuid, stage text) returns void language plpgsql as $$
begin perform pg_temp.command(jsonb_build_object('kind','move_application','application_id',app,'to_stage',stage,'expected_version',(select version from public.hr_applications where id=app),'rationale','Verified progression')); end;
$$;

create temporary table hr_test_ids(kind text primary key,id uuid);
do $$
declare person uuid; app uuid; app2 uuid; req uuid; offer uuid; emp uuid; emp2 uuid; task uuid; prerequisite uuid; review uuid; exit_id uuid; assignment uuid; pool_person uuid; pool_emp uuid; pool_person2 uuid;
 client uuid; project uuid; contract uuid; result jsonb; payload jsonb; previous_events bigint; v integer; stage_time timestamptz; interview_kind text; t record;
begin
 result:=pg_temp.command('{"kind":"create_person","full_name":"Sam Rivera","email":"candidate@example.invalid","skills":"TypeScript, PostgreSQL","notes":"Confidential interview context"}'); person:=(result->>'person_id')::uuid;
 perform pg_temp.command(jsonb_build_object('kind','link_account','person_id',person,'profile_id','11000000-0000-4000-8000-000000000002'));
 insert into hr_test_ids values('person',person);
 payload:=jsonb_build_object('kind','create_person','full_name','Jordan Lee','request_id',gen_random_uuid());
 result:=public.hr_command(payload); previous_events:=(select count(*) from public.hr_events);
 perform pg_temp.assert_true(public.hr_command(payload)=result,'Identical retry returns same result');
 perform pg_temp.assert_true((select count(*) from public.hr_events)=previous_events,'Retry does not duplicate history');
 perform pg_temp.must_fail(payload||'{"full_name":"Changed payload"}','request ID');
 perform pg_temp.must_fail(jsonb_build_object('kind','update_person','person_id',person,'expected_version',999,'full_name','Wrong'),'changed');
 perform pg_temp.assert_true((select full_name from public.hr_people where id=person)='Sam Rivera','Stale save preserves profile');

 result:=pg_temp.command('{"kind":"create_requisition","title":"Platform Engineer","hiring_mode":"sur_mission","client_need":"Build reliable services"}'); req:=(result->>'opportunity_id')::uuid;
 perform pg_temp.assert_true((select status from public.opportunities where id=req)='approved','Creating a hiring need approves it immediately');
 perform pg_temp.assert_true((select decided_by from public.opportunities where id=req)='hr@example.invalid','Creation records the deciding owner');
 result:=pg_temp.command(jsonb_build_object('kind','create_application','person_id',person,'opportunity_id',req)); app:=(result->>'application_id')::uuid;
 insert into hr_test_ids values('application',app);
 result:=pg_temp.command('{"kind":"create_requisition","title":"Data Engineer","hiring_mode":"sur_mission"}');
 req:=(result->>'opportunity_id')::uuid;
 result:=pg_temp.command(jsonb_build_object('kind','create_application','person_id',person,'opportunity_id',req)); app2:=(result->>'application_id')::uuid;
 perform pg_temp.assert_true((select count(*) from public.hr_applications where person_id=person)=2,'One person can have multiple applications');
 perform pg_temp.must_fail(jsonb_build_object('kind','move_application','application_id',app,'expected_version',1,'to_stage','offer'),'required evidence');
 stage_time:=(select stage_entered_at from public.hr_applications where id=app);
 perform pg_temp.command(jsonb_build_object('kind','add_note','person_id',person,'application_id',app,'rationale','Follow up tomorrow'));
 perform pg_temp.assert_true((select stage_entered_at from public.hr_applications where id=app)=stage_time,'Notes do not reset stage age');
 perform pg_temp.move(app,'screening');
 perform pg_temp.command(jsonb_build_object('kind','update_screening','application_id',app,'expected_version',(select version from public.hr_applications where id=app),'screening_summary','Relevant platform experience','screening_recommendation','Proceed to structured interview'));
 perform pg_temp.move(app,'hr_interview');
 foreach interview_kind in array array['hr','technical'] loop
  result:=pg_temp.command(jsonb_build_object('kind','schedule_interview','application_id',app,'interview_kind',interview_kind,'scheduled_at',now()-interval '1 day','panel','interviewer@example.invalid'));
  perform pg_temp.command(jsonb_build_object('kind','complete_interview','interview_id',result->>'interview_id','expected_version',1,'scorecard',jsonb_build_array(jsonb_build_object('competency','Experience','rating',4,'evidence','Discussed a real project')),'notes','Structured interview completed'));
 end loop;
 perform pg_temp.move(app,'technical_interview');
 perform pg_temp.move(app,'client_presentation');
 perform pg_temp.move(app,'decision');
 result:=pg_temp.command(jsonb_build_object('kind','create_offer','application_id',app,'title','Platform Engineer','contract_type','CDI','salary_monthly',4500,'cjm',300,'target_tjm',600,'valid_until',current_date+30)); offer:=(result->>'offer_id')::uuid;
 perform pg_temp.assert_true((select margin_pct from public.offers where id=offer)=50,'Margin is computed by database');
 perform pg_temp.command(jsonb_build_object('kind','approve_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer),'note','Approved budget'));
 perform pg_temp.must_fail(jsonb_build_object('kind','approve_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer),'note','Direction approval'),'Administrator');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 perform pg_temp.command(jsonb_build_object('kind','approve_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer),'note','Direction approval'));
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.move(app,'offer');
 perform pg_temp.command(jsonb_build_object('kind','share_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer)));
 perform pg_temp.assert_true((select status from public.offers where id=offer)='shared','Sharing publishes offer');
 insert into hr_test_ids values('offer',offer);
 perform pg_temp.must_fail(jsonb_build_object('kind','respond_offer','offer_id',offer,'employee_id',gen_random_uuid(),'expected_version',(select version from public.offers where id=offer),'response','accepted','rationale','Spoofed root'),'Unexpected fields');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 perform pg_temp.must_fail(jsonb_build_object('kind','respond_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer),'response','accepted','rationale','Accept'),'not available');
 perform pg_temp.must_fail('{"kind":"create_person","full_name":"Unauthorized"}','HR access');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform pg_temp.command(jsonb_build_object('kind','respond_offer','offer_id',offer,'expected_version',(select version from public.offers where id=offer),'response','accepted','rationale','I accept the offer'));
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.move(app,'contract');
 perform pg_temp.must_fail(jsonb_build_object('kind','hire','application_id',app,'expected_version',(select version from public.hr_applications where id=app),'start_date',current_date,'role','Platform Engineer'),'signed');
 insert into public.contracts(candidate_id,person_id,application_id,title,storage_path,document_sha256)
 values('11000000-0000-4000-8000-000000000002',person,app,'Employment agreement','11000000-0000-4000-8000-000000000002/agreement.pdf',repeat('a',64)) returning id into contract;
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 insert into public.contract_signatures(contract_id,signer_name) values(contract,'Sam Rivera');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.must_fail(jsonb_build_object('kind','hire','application_id',app,'expected_version',(select version from public.hr_applications where id=app),'start_date',current_date,'role','Platform Engineer'),'signed');
 perform pg_temp.command(jsonb_build_object('kind','countersign_contract','contract_id',contract,'signer_name','HR Manager'));
 result:=pg_temp.command(jsonb_build_object('kind','hire','application_id',app,'expected_version',(select version from public.hr_applications where id=app),'start_date',current_date,'role','Platform Engineer','probation_end',current_date+90)); emp:=(result->>'employee_id')::uuid;
 insert into hr_test_ids values('employment',emp);
 perform pg_temp.assert_true((select contract_type from public.employees where id=emp)='CDI','Hire copies the accepted offer contract type');
 perform pg_temp.assert_true((select status from public.hr_applications where id=app)='hired','Hire closes application atomically');
 perform pg_temp.assert_true((select status from public.hr_applications where id=app2)='active','Other application remains separate');
 -- Manager and buddy stay editable after hiring (HR administrators only), with version checks.
 perform pg_temp.command(jsonb_build_object('kind','update_employment','employee_id',emp,'expected_version',(select version from public.employees where id=emp),'manager_email','manager@example.invalid','parrain','Alex Morgan'));
 perform pg_temp.assert_true((select manager_email from public.employees where id=emp)='manager@example.invalid','Manager updated after hire');
 perform pg_temp.assert_true((select parrain from public.employees where id=emp)='Alex Morgan','Buddy updated after hire');
 perform pg_temp.command(jsonb_build_object('kind','update_employment','employee_id',emp,'expected_version',(select version from public.employees where id=emp),'parrain','Jordan Lee'));
 perform pg_temp.assert_true((select manager_email from public.employees where id=emp)='manager@example.invalid','Omitted manager keeps its value');
 perform pg_temp.assert_true((select parrain from public.employees where id=emp)='Jordan Lee','Buddy changed again');
 perform pg_temp.must_fail(jsonb_build_object('kind','update_employment','employee_id',emp,'expected_version',999,'manager_email','stale@example.invalid'),'changed');
 perform pg_temp.assert_true((select manager_email from public.employees where id=emp)='manager@example.invalid','Stale manager save is rejected');
 -- Salary history: hiring seeds the first interval from the accepted offer; a change closes the previous interval the day before it starts.
 perform pg_temp.assert_true((select count(*) from public.employee_salaries where employee_id=emp)=1,'Hire seeds one salary interval from the accepted offer');
 perform pg_temp.assert_true((select salary_monthly from public.employee_salaries where employee_id=emp)=4500,'Seeded salary matches the accepted offer');
 perform pg_temp.assert_true((select start_date from public.employee_salaries where employee_id=emp)=(select start_date from public.employees where id=emp),'Seeded salary starts at the employment start date');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',5000,'start_date',current_date-10),'employment period');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',-1,'start_date',current_date+60),'zero or positive');
 result:=pg_temp.command(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',5000,'start_date',current_date+30,'rationale','Annual raise'));
 perform pg_temp.assert_true((select count(*) from public.employee_salaries where employee_id=emp)=2,'Salary change adds a new interval');
 perform pg_temp.assert_true((select end_date from public.employee_salaries where employee_id=emp and end_date is not null)=current_date+29,'New change closes the previous interval the day before');
 perform pg_temp.assert_true((select salary_monthly from public.employee_salaries where employee_id=emp and end_date is null)=5000,'Latest open interval carries the new salary');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where employee_id=emp and kind='save_salary' and previous_state='4500' and next_state='5000'),'Salary change is audited with old and new amounts');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',5100,'start_date',current_date+10,'end_date',current_date+20,'rationale','Try to overlap'),'overlap');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',5100,'start_date',current_date+30),'already starts');
 -- Corrections to a recorded interval require a rationale and a matching version.
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_id',(select id from public.employee_salaries where employee_id=emp and end_date is null),'expected_version',(select version from public.employee_salaries where employee_id=emp and end_date is null),'salary_monthly',5200,'start_date',current_date+30),'rationale');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_id',(select id from public.employee_salaries where employee_id=emp and end_date is null),'expected_version',999,'salary_monthly',5200,'start_date',current_date+30,'rationale','Fix typo'),'changed');
 perform pg_temp.command(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_id',(select id from public.employee_salaries where employee_id=emp and end_date is null),'expected_version',(select version from public.employee_salaries where employee_id=emp and end_date is null),'salary_monthly',5200,'start_date',current_date+30,'rationale','Fix typo'));
 perform pg_temp.assert_true((select salary_monthly from public.employee_salaries where employee_id=emp and end_date is null)=5200,'Salary correction applies with a rationale');
 -- Direct engagement: a talent-pool person becomes staffable without an application, offer or contract.
 result:=pg_temp.command('{"kind":"create_person","full_name":"Ravi Patel","skills":"React, Node"}'); pool_person:=(result->>'person_id')::uuid;

 perform pg_temp.command(jsonb_build_object('kind','engage_person','person_id',pool_person,'role','Frontend Freelance','contract_type','Freelance','start_date',current_date,'rationale','Freelance already contracted by the client','daily_rate',520));
 pool_emp:=(select id from public.employees where person_id=pool_person);
 perform pg_temp.assert_true((select status from public.employees where id=pool_emp)='active','Immediate engagement starts active');
 perform pg_temp.assert_true((select contract_type from public.employees where id=pool_emp)='Freelance','Engagement stores its contract type');
 -- Freelance compensation is a daily rate: the engagement seeds one daily interval.
 perform pg_temp.assert_true((select rate_kind from public.employee_salaries where employee_id=pool_emp)='daily','Engagement seeds a daily rate interval');
 perform pg_temp.assert_true((select daily_rate from public.employee_salaries where employee_id=pool_emp)=520,'Seeded daily rate matches the engagement');
 perform pg_temp.assert_true((select salary_monthly from public.employee_salaries where employee_id=pool_emp) is null,'Daily intervals carry no monthly figure');
 -- Daily rate changes close the previous open interval the day before.
 perform pg_temp.command(jsonb_build_object('kind','save_salary','employee_id',pool_emp,'rate_kind','daily','daily_rate',560,'start_date',current_date+30,'rationale','Rate renegotiation'));
 perform pg_temp.assert_true((select daily_rate from public.employee_salaries where employee_id=pool_emp and end_date is null)=560,'Latest open daily interval carries the new TJM');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where employee_id=pool_emp and kind='save_salary' and previous_state='520' and next_state='560'),'Daily rate change is audited with old and new amounts');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',pool_emp,'rate_kind','daily','salary_monthly',3000,'start_date',current_date+60,'rationale','Wrong figure'),'Daily rate is required');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',pool_emp,'rate_kind','daily','daily_rate',-1,'start_date',current_date+60,'rationale','Negative'),'zero or positive');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where person_id=pool_person and kind='engage_person' and next_state='engaged'),'Engagement lands in the audit log');
 perform pg_temp.must_fail(jsonb_build_object('kind','engage_person','person_id',pool_person,'role','Again','contract_type','Freelance','start_date',current_date,'rationale','Duplicate engagement'),'open employment period');
 -- Rationale is optional: a direct engagement without one still engages and lands in the audit log.
 result:=pg_temp.command('{"kind":"create_person","full_name":"Tara Nair","skills":"Vue, Node"}'); pool_person2:=(result->>'person_id')::uuid;
 perform pg_temp.command(jsonb_build_object('kind','engage_person','person_id',pool_person2,'role','Backend Freelance','contract_type','Freelance','start_date',current_date));
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where person_id=pool_person2 and kind='engage_person' and next_state='engaged'),'Engagement without rationale lands in the audit log');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
 perform pg_temp.must_fail(jsonb_build_object('kind','engage_person','person_id',pool_person,'role','Nope','contract_type','Freelance','start_date',current_date,'rationale','Sales role tries to engage'),'HR access');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
 perform pg_temp.must_fail(jsonb_build_object('kind','update_employment','employee_id',emp,'expected_version',(select version from public.employees where id=emp),'manager_email','sales@example.invalid'),'HR access');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.must_fail(jsonb_build_object('kind','start_onboarding','employee_id',emp,'expected_version',(select version from public.employees where id=emp)),'preboarding tasks');
 for t in select id,version from public.onboarding_items where employee_id=emp and phase='preboarding' loop
  perform pg_temp.command(jsonb_build_object('kind','complete_task','task_id',t.id,'expected_version',t.version,'evidence','Verified preboarding'));
 end loop;
 perform pg_temp.command(jsonb_build_object('kind','start_onboarding','employee_id',emp,'expected_version',(select version from public.employees where id=emp)));
 perform pg_temp.must_fail(jsonb_build_object('kind','complete_onboarding','employee_id',emp,'expected_version',(select version from public.employees where id=emp)),'required');
 result:=pg_temp.command(jsonb_build_object('kind','save_task','employee_id',emp,'phase','onboarding','title','Access provisioned','assignee','HR','required',true)); prerequisite:=(result->>'task_id')::uuid;
 result:=pg_temp.command(jsonb_build_object('kind','save_task','employee_id',emp,'phase','onboarding','title','Repository walkthrough','assignee','Sam','required',true,'dependency_id',prerequisite)); task:=(result->>'task_id')::uuid;
 perform pg_temp.must_fail(jsonb_build_object('kind','complete_task','task_id',task,'expected_version',1,'evidence','Walkthrough complete'),'dependent');
 for t in select id,version from public.onboarding_items where employee_id=emp and id<>task and completed_at is null order by created_at loop
  perform pg_temp.command(jsonb_build_object('kind','complete_task','task_id',t.id,'expected_version',t.version,'evidence','Verified completion'));
 end loop;
 perform pg_temp.command(jsonb_build_object('kind','complete_task','task_id',task,'expected_version',1,'evidence','Walkthrough completed after access'));
 perform pg_temp.command(jsonb_build_object('kind','complete_onboarding','employee_id',emp,'expected_version',(select version from public.employees where id=emp)));
 perform pg_temp.assert_true((select probation_status from public.employees where id=emp)='pending','Onboarding completion does not confirm probation');
 result:=pg_temp.command(jsonb_build_object('kind','schedule_review','employee_id',emp,'review_kind','probation','due_date',current_date)); review:=(result->>'review_id')::uuid;
 perform pg_temp.command(jsonb_build_object('kind','record_review','review_id',review,'expected_version',1,'outcome','confirmed','rationale','Review held and objectives met'));
 perform pg_temp.assert_true((select probation_status from public.employees where id=emp)='confirmed','Held review confirms probation');

 insert into public.sales_clients(name) values('Test client') returning id into client;
 insert into public.sales_projects(title,client_id,pricing_model,fixed_price,start_date,end_date) values('Delivery',client,'forfait',10000,current_date,current_date+300) returning id into project;
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Engineer','allocation_pct',60,'start_date',current_date,'end_date',current_date+30,'status','confirmed')); assignment:=(result->>'assignment_id')::uuid;
 perform pg_temp.must_fail(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Second allocation','allocation_pct',50,'start_date',current_date+10,'end_date',current_date+20,'status','reserved'),'capacity');
 perform pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Later period','allocation_pct',100,'start_date',current_date+31,'end_date',current_date+60,'status','confirmed'));
 perform pg_temp.assert_true((select count(*) from public.employee_project_assignments where employee_id=emp)=2,'Same project supports non-overlapping periods');
 -- Pricing lines: a régie assignment targets one named TJM profile of the contract.
 insert into public.sales_projects(title,client_id,pricing_model,tjm,estimated_days,tjm_profiles,start_date,end_date) values('Régie squad',client,'regie',650,200,'[{"name":"Data Engineer","tjm":650},{"name":"Lead Dev","tjm":750}]'::jsonb,current_date,current_date+300) returning id into project;
 perform pg_temp.must_fail(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Architect','pricing_line','Architect','allocation_pct',10,'start_date',current_date+61,'end_date',current_date+90,'status','proposed'),'pricing line');
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Data Engineer','pricing_line','Data Engineer','allocation_pct',10,'start_date',current_date+61,'end_date',current_date+90,'status','proposed'));
 perform pg_temp.assert_true((select pricing_line from public.employee_project_assignments where id=(result->>'assignment_id')::uuid)='Data Engineer','Assignment stores its pricing line');
 perform pg_temp.must_fail(jsonb_build_object('kind','update_assignment','assignment_id',(result->>'assignment_id')::uuid,'expected_version',1,'position','Data Engineer','pricing_line','Unknown line','allocation_pct',10,'start_date',current_date+61,'end_date',current_date+90,'status','proposed','rationale','Try an unknown line'),'pricing line');
 result:=pg_temp.command(jsonb_build_object('kind','update_assignment','assignment_id',(result->>'assignment_id')::uuid,'expected_version',1,'position','Lead Developer','pricing_line','Lead Dev','allocation_pct',10,'start_date',current_date+61,'end_date',current_date+90,'status','proposed','rationale','Move to the lead line'));
 perform pg_temp.assert_true((select pricing_line from public.employee_project_assignments where id=(result->>'assignment_id')::uuid)='Lead Dev','Assignment line can be re-pointed with a rationale');
 result:=pg_temp.command(jsonb_build_object('kind','open_exit','employee_id',emp,'expected_version',(select version from public.employees where id=emp),'exit_kind','resignation','exit_date',current_date,'rationale','Resignation received')); exit_id:=(result->>'exit_id')::uuid;
 perform pg_temp.assert_true((select status from public.employees where id=emp)='offboarding','Opening exit enters offboarding atomically');
 perform pg_temp.must_fail(jsonb_build_object('kind','complete_exit','exit_id',exit_id,'expected_version',1),'handover');
 perform pg_temp.command(jsonb_build_object('kind','save_exit','exit_id',exit_id,'expected_version',1,'handover_plan','Repository ownership transferred','successor','Team lead','exit_interview','Discussion completed','rehire_eligible',true,'rehire_rationale','Eligible for future opportunities'));
 for t in select id,version from public.offboarding_items where offboarding_id=exit_id loop
  perform pg_temp.command(jsonb_build_object('kind','complete_exit_item','item_id',t.id,'expected_version',t.version));
 end loop;
 perform pg_temp.command(jsonb_build_object('kind','complete_exit','exit_id',exit_id,'expected_version',(select version from public.offboarding_records where id=exit_id)));
 perform pg_temp.assert_true((select status from public.employees where id=emp)='ended','Completed exit creates alumni employment');
 -- Exit closes the salary history at the exit date and drops changes scheduled after it.
 perform pg_temp.assert_true(not exists(select 1 from public.employee_salaries where employee_id=emp and end_date is null),'Exit closes the open salary interval');
 perform pg_temp.assert_true((select end_date from public.employee_salaries where employee_id=emp and salary_monthly=4500)=current_date,'Exit closes salary history at the exit date');
 perform pg_temp.assert_true((select count(*) from public.employee_salaries where employee_id=emp)=1,'Exit removes salary changes scheduled after the departure');
 perform pg_temp.must_fail(jsonb_build_object('kind','save_salary','employee_id',emp,'salary_monthly',5200,'start_date',current_date),'closed with an end date');
 perform pg_temp.assert_true(not exists(select 1 from public.employee_project_assignments where employee_id=emp and status in ('reserved','confirmed','active')),'Exit closes all commitments');
 perform pg_temp.must_fail(jsonb_build_object('kind','assign_project','employee_id',emp,'project_id',project,'position','Invalid alumni staffing','allocation_pct',20,'start_date',current_date+61,'status','confirmed'),'employment');

 -- Rehire through the ordinary recruitment path, preserving the previous period.
 perform pg_temp.command(jsonb_build_object('kind','update_screening','application_id',app2,'expected_version',1,'screening_summary','Returning colleague, renewed structured assessment','screening_recommendation','Proceed'));
 foreach interview_kind in array array['hr','technical'] loop
  result:=pg_temp.command(jsonb_build_object('kind','schedule_interview','application_id',app2,'interview_kind',interview_kind,'scheduled_at',now(),'panel','interviewer@example.invalid'));
  perform pg_temp.command(jsonb_build_object('kind','complete_interview','interview_id',result->>'interview_id','expected_version',1,'scorecard',jsonb_build_array(jsonb_build_object('competency','Experience','rating',4,'evidence','New assessment')),'notes','New interview completed'));
 end loop;
 perform pg_temp.move(app2,'decision');
 result:=pg_temp.command(jsonb_build_object('kind','create_offer','application_id',app2,'title','Senior Data Engineer','contract_type','CDI','salary_monthly',5000,'cjm',390,'target_tjm',600)); offer:=(result->>'offer_id')::uuid;
 perform pg_temp.command(jsonb_build_object('kind','approve_offer','offer_id',offer,'expected_version',1,'note','Approved renewed budget'));
 perform pg_temp.move(app2,'offer');
 perform pg_temp.command(jsonb_build_object('kind','share_offer','offer_id',offer,'expected_version',2));
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform pg_temp.command(jsonb_build_object('kind','respond_offer','offer_id',offer,'expected_version',3,'response','accepted','rationale','Returning offer accepted'));
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.move(app2,'contract');
 insert into public.contracts(candidate_id,person_id,application_id,title,storage_path,document_sha256)
 values('11000000-0000-4000-8000-000000000002',person,app2,'New employment agreement','11000000-0000-4000-8000-000000000002/rehire.pdf',repeat('b',64)) returning id into contract;
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 insert into public.contract_signatures(contract_id,signer_name) values(contract,'Sam Rivera');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform pg_temp.command(jsonb_build_object('kind','countersign_contract','contract_id',contract,'signer_name','HR Manager'));
 result:=pg_temp.command(jsonb_build_object('kind','hire','application_id',app2,'expected_version',(select version from public.hr_applications where id=app2),'start_date',current_date+61,'role','Senior Data Engineer')); emp2:=(result->>'employee_id')::uuid;
 perform pg_temp.assert_true((select count(*) from public.employees where person_id=person)=2,'Normal rehire adds a separate employment period');
 perform pg_temp.assert_true((select count(*) from public.hr_people where id=person)=1,'Normal rehire preserves person identity');
 perform pg_temp.assert_true((select status from public.employees where id=emp)='ended','Normal rehire retains prior exit history');

 -- Candidate renunciation cancels a preboarding hire without the offboarding ceremony.
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp2,'project_id',project,'position','Future allocation','allocation_pct',50,'start_date',current_date+61,'end_date',current_date+90,'status','reserved'));
 perform pg_temp.must_fail(jsonb_build_object('kind','cancel_hire','employee_id',emp2,'expected_version',(select version from public.employees where id=emp2)),'required fields');
 perform pg_temp.command(jsonb_build_object('kind','cancel_hire','employee_id',emp2,'expected_version',(select version from public.employees where id=emp2),'rationale','Candidate renounced before the start date'));
 perform pg_temp.assert_true((select status from public.employees where id=emp2)='ended','Renunciation ends the preboarding employment');
 perform pg_temp.assert_true((select end_date from public.employees where id=emp2)=(select start_date from public.employees where id=emp2),'Renunciation closes employment at the planned start date');
 perform pg_temp.assert_true((select probation_status from public.employees where id=emp2)='ended','Renunciation ends pending probation');
 perform pg_temp.assert_true((select status from public.hr_applications where id=app2)='withdrawn','Renunciation withdraws the linked application');
 perform pg_temp.assert_true((select reason from public.hr_applications where id=app2)='Candidate renounced before the start date','Renunciation rationale recorded on the application');
 perform pg_temp.assert_true((select status from public.offers where id=offer)='cancelled','Renunciation cancels the accepted offer');
 perform pg_temp.assert_true(not exists(select 1 from public.employee_project_assignments where employee_id=emp2 and status<>'cancelled'),'Renunciation cancels open commitments');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where employee_id=emp2 and kind='cancel_hire' and previous_state='preboarding' and next_state='ended'),'Renunciation recorded in history');
 perform pg_temp.must_fail(jsonb_build_object('kind','cancel_hire','employee_id',emp2,'expected_version',(select version from public.employees where id=emp2),'rationale','Cancel again'),'preboarding');
 perform pg_temp.must_fail(jsonb_build_object('kind','start_onboarding','employee_id',emp2,'expected_version',(select version from public.employees where id=emp2)),'preboarding');

 payload:=jsonb_build_object('kind','import_person','external_source','historical-test','external_id','resource-1','full_name','Imported Person','rationale','Historical import','employment',jsonb_build_object('role','Engineer','start_date','2025-01-01','end_date','2025-12-01'));
 perform pg_temp.must_fail(payload,'administrators');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 result:=pg_temp.command(payload); v:=(select count(*) from public.employees where person_id=(result->>'person_id')::uuid);
 perform pg_temp.command(payload);
 perform pg_temp.assert_true((select count(*) from public.employees where person_id=(result->>'person_id')::uuid)=v,'Repeated stable import does not duplicate employment');
 payload:=jsonb_build_object('kind','import_person','external_source','historical-test','external_id','resource-1','full_name','Imported Person renamed','rationale','Historical rehire import','employment',jsonb_build_object('role','Senior Engineer','start_date','2026-01-01'));
 perform pg_temp.command(payload);
 perform pg_temp.assert_true((select count(*) from public.hr_people where id=(result->>'person_id')::uuid)=1,'Rehire preserves one person');
 perform pg_temp.assert_true((select count(*) from public.employees where person_id=(result->>'person_id')::uuid)=2,'New historical period preserves prior period');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where person_id=person and kind='hire') and exists(select 1 from public.hr_events where person_id=person and kind='complete_exit'),'History spans recruitment to alumni');
end;
$$;

-- Publishing changes the requisition and its real public post together.
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare requisition public.opportunities; job uuid; person uuid;
begin
 select * into requisition from public.opportunities where title='Platform Engineer';
 insert into public.jobs(slug,title,location,description,linkedin_url) values('platform-engineer','Platform Engineer','Paris','Build reliable platform services.','https://www.linkedin.com/jobs/view/123') returning id into job;
 perform pg_temp.command(jsonb_build_object('kind','publish_requisition','opportunity_id',requisition.id,'expected_version',requisition.version,'job_id',job));
 perform pg_temp.assert_true((select published from public.jobs where id=job),'Publishing exposes the actual linked job post');
 perform pg_temp.assert_true((select status from public.opportunities where id=requisition.id)='published','Publishing updates requisition atomically');
 select id into person from public.hr_people where full_name='Jordan Lee';
 perform pg_temp.command(jsonb_build_object('kind','create_application','person_id',person,'opportunity_id',requisition.id));
end;
$$;

-- A hiring need links to a job post and to one or several clients.
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare first_client uuid; second_client uuid; job uuid; result jsonb; req uuid; req_version integer;
begin
 insert into public.sales_clients(name) values('Hiring client A') returning id into first_client;
 insert into public.sales_clients(name) values('Hiring client B') returning id into second_client;
 insert into public.jobs(slug,title,location,description,linkedin_url) values('qa-engineer','QA Engineer','Lyon','Automate quality gates.','https://www.linkedin.com/jobs/view/456') returning id into job;
 result:=pg_temp.command(jsonb_build_object('kind','create_requisition','title','QA Engineer','hiring_mode','sur_mission','job_id',job,'client_ids',jsonb_build_array(first_client,second_client)));
 req:=(result->>'opportunity_id')::uuid;
 perform pg_temp.must_fail('{"kind":"create_requisition","title":"Bench Hire","hiring_mode":"sur_profil"}','Profile hiring justification');
 perform pg_temp.must_fail(jsonb_build_object('kind','approve_requisition','opportunity_id',req,'expected_version',1,'rationale','Legacy approval step'),'Unknown HR command');
 perform pg_temp.assert_true((select status from public.opportunities where id=req)='approved','A hiring need is approved at creation');
 perform pg_temp.assert_true((select client_ids from public.opportunities where id=req)=array(select v from unnest(array[first_client,second_client]) u(v) order by v),'Creating a hiring need links several clients');
 perform pg_temp.assert_true((select job_id from public.opportunities where id=req)=job,'Creating a hiring need links its job post');
 req_version:=(select version from public.opportunities where id=req);
 perform pg_temp.must_fail(jsonb_build_object('kind','update_requisition','opportunity_id',req,'expected_version',req_version,'title','QA Engineer','hiring_mode','sur_mission','client_ids',jsonb_build_array(gen_random_uuid())),'Unknown client');
 perform pg_temp.command(jsonb_build_object('kind','update_requisition','opportunity_id',req,'expected_version',req_version,'title','QA Engineer','hiring_mode','sur_mission','client_ids',jsonb_build_array(second_client)));
 perform pg_temp.assert_true((select client_ids from public.opportunities where id=req)=array[second_client]::uuid[],'Editing a hiring need replaces its client links');
 perform pg_temp.assert_true((select count(*) from public.opportunities where id=req)=1,'Client link edits stay on the same requisition');
end;
$$;

-- Source version checks prevent reviewing advice after the underlying demand changes.
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare p public.hr_people; project public.sales_projects; suggestion uuid; result jsonb; payload jsonb; before_tasks bigint;
begin
 select * into p from public.hr_people where id=(select id from hr_test_ids where kind='person');
 select * into project from public.sales_projects where title='Delivery';
 payload:=jsonb_build_object('kind','save_suggestion','person_id',p.id,'suggestion_kind','staffing_match','input_version',p.version,'model','test-model','payload',jsonb_build_object('summary','Review project fit','items',jsonb_build_array(jsonb_build_object('title','Assess project','detail','Human review needed','source_ids',jsonb_build_array(p.id,project.id)))),'sources',jsonb_build_array(jsonb_build_object('type','person','id',p.id,'version',p.version),jsonb_build_object('type','project','id',project.id,'version',project.version)));
 perform pg_temp.must_fail(payload||jsonb_build_object('input_version',999),'changed');
 result:=pg_temp.command(payload); suggestion:=(result->>'suggestion_id')::uuid;
 update public.sales_projects set title='Delivery updated' where id=project.id;
 perform pg_temp.assert_true((select version from public.sales_projects where id=project.id)=project.version+1,'Project edits advance evidence version');
 perform pg_temp.must_fail(jsonb_build_object('kind','review_suggestion','suggestion_id',suggestion,'status','accepted'),'stale');
 payload:=jsonb_set(payload,'{sources,1,version}',to_jsonb(project.version+1));
 result:=pg_temp.command(payload); suggestion:=(result->>'suggestion_id')::uuid;
 before_tasks:=(select count(*) from public.onboarding_items);
 perform pg_temp.command(jsonb_build_object('kind','review_suggestion','suggestion_id',suggestion,'status','accepted'));
 perform pg_temp.assert_true((select count(*) from public.onboarding_items)=before_tasks,'Reviewing advice does not automatically apply facts');
 perform set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
 result:=public.hr_workspace_snapshot();
 perform pg_temp.assert_true(jsonb_array_length(result->'offers')=0 and jsonb_array_length(result->'contracts')=0 and jsonb_array_length(result->'events')=0 and jsonb_array_length(result->'salaries')=0,'Sales staffing projection excludes compensation/contracts/history');
 perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(result->'people') j where j->>'notes'<>'' or j->>'email'<>'' or j->>'phone'<>''),'Sales staffing projection excludes private notes and contacts');
 perform pg_temp.must_fail(jsonb_build_object('kind','update_person','person_id',p.id,'expected_version',p.version,'full_name','Sales edit'),'HR access');
end;
$$;

-- Signed project extensions auto-extend open commitments on the project.
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$
declare person uuid; emp_active uuid; emp_second uuid; client2 uuid; project2 uuid; project3 uuid; project4 uuid;
 a1 uuid; a2 uuid; a3 uuid; a4 uuid; result jsonb;
begin
 select person_id into person from public.hr_person_external_ids where external_source='historical-test' and external_id='resource-1';
 select id into emp_active from public.employees where person_id=person and end_date is null;
 result:=pg_temp.command(jsonb_build_object('kind','import_person','external_source','auto-extend-test','external_id','resource-2','full_name','Second Consultant','rationale','Auto-extend test staffing','employment',jsonb_build_object('role','Engineer','start_date',current_date)));
 select id into emp_second from public.employees where person_id=(result->>'person_id')::uuid and end_date is null;
 insert into public.sales_clients(name) values('Auto-extend client') returning id into client2;
 insert into public.sales_projects(title,client_id,pricing_model,tjm,estimated_days,start_date,end_date) values('Renewable',client2,'regie',600,22,current_date,current_date+30) returning id into project2;
 insert into public.sales_projects(title,client_id,pricing_model,tjm,estimated_days,start_date,end_date) values('Overbooked',client2,'regie',600,22,current_date,current_date+30) returning id into project3;
 insert into public.sales_projects(title,client_id,pricing_model,tjm,estimated_days,start_date,end_date) values('Side booking',client2,'regie',600,60,current_date+31,current_date+90) returning id into project4;
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp_active,'project_id',project2,'position','Engineer','allocation_pct',60,'start_date',current_date,'end_date',current_date+30,'status','confirmed')); a1:=(result->>'assignment_id')::uuid;
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp_second,'project_id',project3,'position','Engineer','allocation_pct',60,'start_date',current_date,'end_date',current_date+30,'status','confirmed')); a2:=(result->>'assignment_id')::uuid;
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp_second,'project_id',project4,'position','Engineer','allocation_pct',50,'start_date',current_date+31,'end_date',current_date+90,'status','confirmed')); a3:=(result->>'assignment_id')::uuid;
 result:=pg_temp.command(jsonb_build_object('kind','assign_project','employee_id',emp_second,'project_id',project2,'position','Reserved backup','allocation_pct',10,'start_date',current_date,'end_date',current_date+30,'status','reserved')); a4:=(result->>'assignment_id')::uuid;
 -- A planned extension moves nothing yet.
 insert into public.sales_project_extensions(project_id,pricing_model,tjm,estimated_days,status,start_date,end_date) values(project2,'regie',600,60,'planned',current_date+31,current_date+90);
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a1)=current_date+30,'Planned extension leaves commitments unchanged');
 perform pg_temp.assert_true((select end_date from public.sales_projects where id=project2)=current_date+30,'Planned extension leaves the contract end unchanged');
 insert into hr_test_ids values('auto_a1',a1),('auto_a2',a2),('auto_a3',a3),('auto_a4',a4),('auto_emp_active',emp_active),('auto_emp_second',emp_second),('auto_project2',project2),('auto_project3',project3);
end;
$$;

-- Signing through the real access path (authenticated admin, RLS policy enforced) extends contract, commitment and audit trail.
grant insert on public.sales_project_extensions to authenticated;
grant select on hr_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
insert into public.sales_project_extensions(project_id,pricing_model,tjm,estimated_days,status,start_date,end_date) values((select id from hr_test_ids where kind='auto_project2'),'regie',620,90,'signed',current_date+31,current_date+120);
reset role;

do $$
declare a1 uuid:=(select id from hr_test_ids where kind='auto_a1'); a2 uuid:=(select id from hr_test_ids where kind='auto_a2'); a4 uuid:=(select id from hr_test_ids where kind='auto_a4');
 emp_active uuid:=(select id from hr_test_ids where kind='auto_emp_active'); emp_second uuid:=(select id from hr_test_ids where kind='auto_emp_second');
 project2 uuid:=(select id from hr_test_ids where kind='auto_project2'); project3 uuid:=(select id from hr_test_ids where kind='auto_project3'); ext uuid;
begin
 perform pg_temp.assert_true((select end_date from public.sales_projects where id=project2)=current_date+120,'Signed extension moves the contract end date');
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a1)=current_date+120,'Signed extension auto-extends the open confirmed assignment');
 perform pg_temp.assert_true((select version from public.employee_project_assignments where id=a1)=2,'Auto-extension bumps the assignment version');
 perform pg_temp.assert_true(exists(select 1 from public.hr_events where employee_id=emp_active and kind='assignment_auto_extended' and previous_state=(current_date+30)::text and next_state=(current_date+120)::text and actor_id='11000000-0000-4000-8000-000000000004'),'Auto-extension is audited with the signing actor');
 -- Tentative commitments never auto-extend.
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a4)=current_date+30,'Reserved commitments are not auto-extended');
 -- A later extension pushes the same assignment further.
 insert into public.sales_project_extensions(project_id,pricing_model,tjm,estimated_days,status,start_date,end_date) values(project2,'regie',620,60,'signed',current_date+121,current_date+180) returning id into ext;
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a1)=current_date+180,'A further signed extension pushes the assignment again');
 -- Moves are forward-only: un-signing never rolls commitments back.
 update public.sales_project_extensions set status='planned' where id=ext;
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a1)=current_date+180,'Un-signing an extension never rolls assignments back');
 perform pg_temp.assert_true((select end_date from public.sales_projects where id=project2)>=current_date+120,'Un-signing an extension never rolls the contract end back');
 -- The capacity guard blocks a move that would exceed 100% on the employee.
 insert into public.sales_project_extensions(project_id,pricing_model,tjm,estimated_days,status,start_date,end_date) values(project3,'regie',600,90,'signed',current_date+31,current_date+120);
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a2)=current_date+30,'Conflicting commitment is not auto-extended over capacity');
 perform pg_temp.assert_true(not exists(select 1 from public.hr_events where employee_id=emp_second and kind='assignment_auto_extended'),'Blocked auto-extension leaves no audit event');
end;
$$;

-- Once the conflicting booking ends, a later extension extends the commitment.
do $$
declare a1 uuid:=(select id from hr_test_ids where kind='auto_a1'); a2 uuid:=(select id from hr_test_ids where kind='auto_a2'); a3 uuid:=(select id from hr_test_ids where kind='auto_a3');
 project3 uuid:=(select id from hr_test_ids where kind='auto_project3');
begin
 perform pg_temp.command(jsonb_build_object('kind','end_assignment','assignment_id',a3,'expected_version',(select version from public.employee_project_assignments where id=a3),'end_date',current_date,'rationale','Side booking cancelled','cancel',true));
 insert into public.sales_project_extensions(project_id,pricing_model,tjm,estimated_days,status,start_date,end_date) values(project3,'regie',600,120,'signed',current_date+121,current_date+150);
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a2)=current_date+150,'Once capacity frees, a later extension extends the commitment');
 perform pg_temp.assert_true((select end_date from public.employee_project_assignments where id=a1)=current_date+180,'Extensions of one project do not touch another project assignments');
end;
$$;

-- Exercise actual RLS/table grants as the portal actor, not the database owner.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*) from public.my_applications)=2,'Portal shows both explicitly mapped applications');
select pg_temp.assert_true((select count(*) from public.my_offers)=2,'Portal sees its shared offer');
select pg_temp.assert_true((select count(*) from public.my_employment)=2,'Portal sees own employment');
do $$
declare denied boolean:=false;
begin
 begin insert into public.hr_people(full_name) values('Unauthorized direct write'); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.assert_true(denied,'Direct lifecycle table writes are denied');
end;
$$;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*) from public.my_applications)=0,'Other account cannot see applications');
select pg_temp.assert_true((select count(*) from public.my_offers)=0,'Other account cannot see offers');
select pg_temp.assert_true((select count(*) from public.hr_people)=0,'Other account cannot see confidential people');
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select 'HR_FIXTURE:'||public.hr_workspace_snapshot()::text;
select 'Verified: transactional gates, optimistic versions, retry idempotency, scoped portal, signatures, onboarding, probation, capacity, exits, imports and rehires.';
rollback;
