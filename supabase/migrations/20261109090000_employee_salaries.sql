-- Employee salaries: each employment period carries a dated salary history
-- instead of a single figure, so raises and corrections stay auditable.
-- employee_salaries stores non-overlapping intervals per employment period;
-- the interval with a null end_date is the current one. Hiring seeds the
-- first interval from the accepted offer, and save_salary records changes:
-- a new entry closes the previous open interval the day before it starts.
-- Staff-only accounts see no salary data (the snapshot gates it like offers).
create table public.employee_salaries (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 salary_monthly numeric not null check (salary_monthly >= 0),
 start_date date not null,
 end_date date,
 rationale text not null default '' check (length(rationale) <= 2000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (end_date is null or end_date >= start_date)
);

create unique index hr_one_open_salary on public.employee_salaries(employee_id) where end_date is null;

create index hr_salaries_employee on public.employee_salaries(employee_id,start_date,end_date);

alter table public.employee_salaries enable row level security;

create policy employee_salaries_admin on public.employee_salaries for all to authenticated
 using (true) with check (true);

create or replace function public.hr_workspace_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare hr boolean:=private.hr_operator(); staff boolean:=private.hr_staffer();
begin
 if not staff then raise exception 'HR or staffing access required.'; end if;
 return jsonb_build_object(
 'capabilities',jsonb_build_object('recruit',hr,'approve_offer',hr,'approve_direction',private.is_admin(),'staff',staff,'admin',private.is_admin()),
 'people',coalesce((select jsonb_agg(case when hr then to_jsonb(p) else to_jsonb(p)||jsonb_build_object('notes','','email','','phone','','contact_allowed',false) end order by p.full_name) from public.hr_people p),'[]'),
 'applications',case when hr then coalesce((select jsonb_agg(a order by created_at desc) from public.hr_applications a),'[]') else '[]'::jsonb end,
 'employees',coalesce((select jsonb_agg(e order by start_date desc) from public.employees e),'[]'),
 'salaries',case when hr then coalesce((select jsonb_agg(s order by start_date) from public.employee_salaries s),'[]') else '[]'::jsonb end,
 'opportunities',case when hr then coalesce((select jsonb_agg(o order by created_at desc) from public.opportunities o),'[]') else '[]'::jsonb end,
 'interviews',case when hr then coalesce((select jsonb_agg(i order by scheduled_at) from public.interviews i),'[]') else '[]'::jsonb end,
 'offers',case when hr then coalesce((select jsonb_agg(o order by created_at desc) from public.offers o),'[]') else '[]'::jsonb end,
 'tasks',case when hr then coalesce((select jsonb_agg(t order by due_date) from public.onboarding_items t),'[]') else '[]'::jsonb end,
 'reviews',case when hr then coalesce((select jsonb_agg(r order by due_date) from public.reviews r),'[]') else '[]'::jsonb end,
 'exits',case when hr then coalesce((select jsonb_agg(x order by exit_date) from public.offboarding_records x),'[]') else '[]'::jsonb end,
 'exitItems',case when hr then coalesce((select jsonb_agg(i) from public.offboarding_items i),'[]') else '[]'::jsonb end,
 'assignments',coalesce((select jsonb_agg(a order by start_date) from public.employee_project_assignments a),'[]'),
 'events',case when hr then coalesce((select jsonb_agg(e order by created_at) from public.hr_events e),'[]') else '[]'::jsonb end,
 'contracts',case when hr then coalesce((select jsonb_agg(c) from public.contracts c),'[]') else '[]'::jsonb end,
 'signatures',case when hr then coalesce((select jsonb_agg(s) from public.contract_signatures s),'[]') else '[]'::jsonb end,
 'countersignatures',case when hr then coalesce((select jsonb_agg(s) from public.contract_countersignatures s),'[]') else '[]'::jsonb end,
 'suggestions',case when hr then coalesce((select jsonb_agg(s order by created_at desc) from public.hr_ai_suggestions s),'[]') else '[]'::jsonb end,
 'projects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'title',title,'client_id',client_id,'status',status,'start_date',start_date,'end_date',end_date,'pricing_model',pricing_model,'currency',currency,'tjm_profiles',tjm_profiles)) from public.sales_projects),'[]'),
 'clients',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.sales_clients),'[]'),
 'accounts',case when hr then coalesce((select jsonb_agg(a) from public.hr_person_accounts a),'[]') else '[]'::jsonb end,
 'jobs',case when hr then coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'published',published)) from public.jobs),'[]') else '[]'::jsonb end
 );
end;
$$;

create or replace function public.hr_command(command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=private.workspace_user_id(); actor_email text; kind text:=command->>'kind'; request uuid:=(command->>'request_id')::uuid;
 allowed text[]; required_keys text[]; result jsonb; receipt public.hr_command_receipts; person uuid; app uuid; emp uuid; item uuid; oid uuid; iid uuid; xid uuid; sid uuid;
 i public.interviews; a public.hr_applications; e public.employees; o public.offers; r public.reviews; t public.onboarding_items; x public.offboarding_records; xi public.offboarding_items;
 ass public.employee_project_assignments; opp public.opportunities; s public.hr_ai_suggestions; p public.hr_people;
 prev text:=''; nxt text:=''; reqs jsonb; authority text; startday date; endday date; evidence_source jsonb; source_version integer; created boolean:=false; client_links uuid[];
begin
 if actor is null or request is null then raise exception 'Authentication and request_id are required.'; end if;
 if jsonb_typeof(command)<>'object' then raise exception 'Command must be an object.'; end if;
 case kind
 when 'create_person' then allowed:=array['certifications','contact_allowed','degrees','email','full_name','headline','kind','languages','location','notes','owner_email','phone','request_id','skills','source']; required_keys:=array['full_name','kind','request_id'];
 when 'update_person' then allowed:=array['certifications','contact_allowed','degrees','email','expected_version','full_name','headline','kind','languages','location','notes','owner_email','person_id','phone','request_id','skills','source']; required_keys:=array['expected_version','full_name','kind','person_id','request_id'];
 when 'link_account' then allowed:=array['kind','person_id','profile_id','request_id']; required_keys:=array['kind','person_id','profile_id','request_id'];
 when 'create_application' then allowed:=array['kind','opportunity_id','person_id','referrer','request_id','source']; required_keys:=array['kind','opportunity_id','person_id','request_id'];
 when 'move_application' then allowed:=array['application_id','expected_version','kind','rationale','request_id','to_stage']; required_keys:=array['application_id','expected_version','kind','request_id','to_stage'];
 when 'dispose_application' then allowed:=array['application_id','expected_version','kind','reason','request_id','status']; required_keys:=array['application_id','expected_version','kind','reason','request_id','status'];
 when 'update_screening' then allowed:=array['application_id','expected_version','kind','request_id','screening_recommendation','screening_summary']; required_keys:=array['application_id','expected_version','kind','request_id','screening_recommendation','screening_summary'];
 when 'add_note' then allowed:=array['application_id','employee_id','kind','person_id','rationale','request_id']; required_keys:=array['kind','person_id','rationale','request_id'];
 when 'schedule_interview' then allowed:=array['application_id','interview_kind','kind','location','panel','request_id','scheduled_at']; required_keys:=array['application_id','interview_kind','kind','panel','request_id','scheduled_at'];
 when 'complete_interview' then allowed:=array['expected_version','interview_id','kind','notes','request_id','scorecard']; required_keys:=array['expected_version','interview_id','kind','notes','request_id','scorecard'];
 when 'cancel_interview' then allowed:=array['expected_version','interview_id','kind','rationale','request_id']; required_keys:=array['expected_version','interview_id','kind','rationale','request_id'];
 when 'create_offer' then allowed:=array['application_id','cjm','contract_type','kind','request_id','salary_monthly','target_tjm','title','valid_until']; required_keys:=array['application_id','cjm','contract_type','kind','request_id','salary_monthly','target_tjm','title'];
 when 'approve_offer' then allowed:=array['expected_version','kind','note','offer_id','request_id']; required_keys:=array['expected_version','kind','note','offer_id','request_id'];
 when 'cancel_offer' then allowed:=array['expected_version','kind','offer_id','rationale','request_id']; required_keys:=array['expected_version','kind','offer_id','rationale','request_id'];
 when 'share_offer' then allowed:=array['expected_version','kind','offer_id','request_id']; required_keys:=array['expected_version','kind','offer_id','request_id'];
 when 'respond_offer' then allowed:=array['expected_version','kind','offer_id','rationale','request_id','response']; required_keys:=array['expected_version','kind','offer_id','rationale','request_id','response'];
 when 'hire' then allowed:=array['application_id','expected_version','kind','manager_email','parrain','probation_end','request_id','role','start_date']; required_keys:=array['application_id','expected_version','kind','request_id','role','start_date'];
 when 'start_onboarding' then allowed:=array['employee_id','expected_version','kind','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'complete_onboarding' then allowed:=array['employee_id','expected_version','kind','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'update_employment' then allowed:=array['employee_id','expected_version','kind','manager_email','parrain','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'cancel_hire' then allowed:=array['employee_id','expected_version','kind','rationale','request_id']; required_keys:=array['employee_id','expected_version','kind','rationale','request_id'];
 when 'save_task' then allowed:=array['assignee','dependency_id','due_date','employee_id','evidence','expected_version','kind','phase','request_id','required','task_id','title']; required_keys:=array['assignee','employee_id','kind','phase','request_id','title'];
 when 'complete_task' then allowed:=array['evidence','expected_version','kind','request_id','task_id']; required_keys:=array['evidence','expected_version','kind','request_id','task_id'];
 when 'schedule_review' then allowed:=array['due_date','employee_id','kind','request_id','review_kind']; required_keys:=array['due_date','employee_id','kind','request_id','review_kind'];
 when 'record_review' then allowed:=array['expected_version','kind','outcome','probation_end','rationale','request_id','review_id']; required_keys:=array['expected_version','kind','outcome','rationale','request_id','review_id'];
 when 'open_exit' then allowed:=array['employee_id','exit_date','exit_kind','expected_version','kind','notice_end','rationale','request_id']; required_keys:=array['employee_id','exit_date','exit_kind','expected_version','kind','rationale','request_id'];
 when 'save_exit' then allowed:=array['exit_id','exit_interview','expected_version','handover_plan','kind','legal_docs_evidence','rehire_eligible','rehire_rationale','request_id','successor']; required_keys:=array['exit_id','exit_interview','expected_version','handover_plan','kind','legal_docs_evidence','rehire_eligible','rehire_rationale','request_id','successor'];
 when 'complete_exit' then allowed:=array['exit_id','expected_version','kind','request_id']; required_keys:=array['exit_id','expected_version','kind','request_id'];
 when 'save_exit_item' then allowed:=array['evidence','exit_id','expected_version','item_id','kind','request_id','required','title']; required_keys:=array['exit_id','kind','request_id','title'];
 when 'complete_exit_item' then allowed:=array['evidence','expected_version','item_id','kind','request_id']; required_keys:=array['evidence','expected_version','item_id','kind','request_id'];
 when 'assign_project' then allowed:=array['allocation_pct','employee_id','end_date','kind','position','pricing_line','project_id','request_id','start_date','status']; required_keys:=array['allocation_pct','employee_id','kind','position','project_id','request_id','start_date','status'];
 when 'update_assignment' then allowed:=array['allocation_pct','assignment_id','end_date','expected_version','kind','position','pricing_line','rationale','request_id','start_date','status']; required_keys:=array['allocation_pct','assignment_id','expected_version','kind','position','rationale','request_id','start_date','status'];
 when 'end_assignment' then allowed:=array['assignment_id','cancel','end_date','expected_version','kind','rationale','request_id']; required_keys:=array['assignment_id','end_date','expected_version','kind','rationale','request_id'];
 when 'create_requisition' then allowed:=array['client_ids','client_need','hiring_mode','job_id','justification','kind','owner_email','project_id','request_id','skill_family','target_tjm','title']; required_keys:=array['hiring_mode','kind','request_id','title'];
 when 'update_requisition' then allowed:=array['client_ids','client_need','expected_version','hiring_mode','job_id','justification','kind','opportunity_id','owner_email','project_id','request_id','skill_family','target_tjm','title']; required_keys:=array['expected_version','hiring_mode','kind','opportunity_id','request_id','title'];
 when 'publish_requisition' then allowed:=array['expected_version','job_id','kind','opportunity_id','request_id']; required_keys:=array['expected_version','job_id','kind','opportunity_id','request_id'];
 when 'countersign_contract' then allowed:=array['contract_id','kind','request_id','signer_name']; required_keys:=array['contract_id','kind','request_id','signer_name'];
 when 'save_suggestion' then allowed:=array['application_id','employee_id','input_version','kind','model','opportunity_id','payload','person_id','request_id','sources','suggestion_kind']; required_keys:=array['input_version','kind','model','payload','request_id','sources','suggestion_kind'];
 when 'review_suggestion' then allowed:=array['kind','request_id','status','suggestion_id']; required_keys:=array['kind','request_id','status','suggestion_id'];
 when 'import_person' then allowed:=array['certifications','contact_allowed','degrees','email','employment','external_id','external_source','full_name','headline','kind','languages','location','notes','owner_email','phone','rationale','request_id','skills','source']; required_keys:=array['external_id','external_source','full_name','kind','rationale','request_id'];
 else raise exception 'Unknown HR command: %',kind;
 end case;
 if exists(select 1 from jsonb_object_keys(command) k where not (k=any(allowed))) then raise exception 'Unexpected fields for HR command %.',kind; end if;
 if exists(select 1 from unnest(required_keys) k where not (command ? k)) then raise exception 'Missing required fields for HR command %.',kind; end if;
 if command ? 'client_ids' then
  if jsonb_typeof(command->'client_ids')<>'array' then raise exception 'Client links must be an array of client identifiers.'; end if;
  client_links:=coalesce((select array_agg(distinct v::uuid order by v::uuid) from jsonb_array_elements_text(command->'client_ids') v),'{}');
  if exists(select 1 from unnest(client_links) c(id) where not exists(select 1 from public.sales_clients where id=c.id)) then raise exception 'Unknown client link.'; end if;
 end if;
 select email into actor_email from public.profiles where id=actor;
 if actor_email is null then raise exception 'Workspace account not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request::text,0));
 select * into receipt from public.hr_command_receipts where actor_id=actor and request_id=request;
 if found then
  if receipt.command<>command then raise exception 'This request ID was already used for another command.'; end if;
  return receipt.result;
 end if;
 if not private.hr_operator() and not (private.hr_staffer() and kind in ('assign_project','update_assignment','end_assignment')) and kind not in ('respond_offer','complete_task') then raise exception 'HR access required.'; end if;
 person:=nullif(command->>'person_id','')::uuid; app:=nullif(command->>'application_id','')::uuid; emp:=nullif(command->>'employee_id','')::uuid;
 if command ? 'suggestion_id' then select person_id,application_id,employee_id into person,app,emp from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid; end if;
 if command ? 'contract_id' then select person_id,application_id,employee_id into person,app,emp from public.contracts where id=(command->>'contract_id')::uuid; end if;
 if command ? 'interview_id' then select application_id into app from public.interviews where id=(command->>'interview_id')::uuid; end if;
 if command ? 'offer_id' then select application_id into app from public.offers where id=(command->>'offer_id')::uuid; end if;
 if command ? 'task_id' then select employee_id into emp from public.onboarding_items where id=(command->>'task_id')::uuid; end if;
 if command ? 'review_id' then select employee_id into emp from public.reviews where id=(command->>'review_id')::uuid; end if;
 if command ? 'exit_id' then select employee_id into emp from public.offboarding_records where id=(command->>'exit_id')::uuid; end if;
 if command ? 'assignment_id' then select employee_id into emp from public.employee_project_assignments where id=(command->>'assignment_id')::uuid; end if;
 if command ? 'item_id' then select exit_root.employee_id into emp from public.offboarding_records exit_root join public.offboarding_items exit_item on exit_item.offboarding_id=exit_root.id where exit_item.id=(command->>'item_id')::uuid; end if;
 if app is not null then select person_id into person from public.hr_applications where id=app; end if;
 if emp is not null then select person_id into person from public.employees where id=emp; end if;
 if person is not null then select * into p from public.hr_people where id=person for update; if not found then raise exception 'Person not found.'; end if; end if;
 if app is not null then select * into a from public.hr_applications where id=app for update; if not found then raise exception 'Application not found.'; end if; end if;
 if emp is not null then select * into e from public.employees where id=emp for update; if not found then raise exception 'Employment not found.'; end if; end if;
 if app is not null and emp is not null and a.person_id is distinct from e.person_id then raise exception 'Application and employment belong to different people.'; end if;
 if nullif(command->>'person_id','') is not null and person is distinct from (command->>'person_id')::uuid then raise exception 'Record does not belong to selected person.'; end if;
 if nullif(command->>'application_id','') is not null and app is distinct from (command->>'application_id')::uuid then raise exception 'Record does not belong to selected application.'; end if;
 if nullif(command->>'employee_id','') is not null and emp is distinct from (command->>'employee_id')::uuid then raise exception 'Record does not belong to selected employment.'; end if;
 if kind='review_suggestion' then
  select * into s from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid;
  perform req_source.id from public.opportunities req_source where req_source.id in (select (j->>'id')::uuid from jsonb_array_elements(s.sources) j where j->>'type'='opportunity') order by req_source.id for share;
  perform pr.id from public.sales_projects pr where pr.id in (select (j->>'id')::uuid from jsonb_array_elements(s.sources) j where j->>'type'='project') order by pr.id for share;
 end if;
 if not private.hr_operator() and kind='respond_offer' and not exists(select 1 from public.hr_person_accounts where profile_id=actor and person_id=person) then raise exception 'Offer not available to this account.'; end if;
 if not private.hr_operator() and kind='complete_task' and not exists(select 1 from public.hr_person_accounts where profile_id=actor and person_id=person) then raise exception 'Task not available to this account.'; end if;
 result:=jsonb_build_object('request_id',request);
 case kind
 when 'create_person','import_person' then
  if kind='import_person' then
   if length(trim(coalesce(command->>'external_source','')))=0 or length(trim(coalesce(command->>'external_id','')))=0 or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Import source, identity and rationale are required.'; end if;
   perform pg_advisory_xact_lock(hashtextextended(command->>'external_source'||':'||(command->>'external_id'),0));
   select person_id into person from public.hr_person_external_ids where external_source=command->>'external_source' and external_id=command->>'external_id';
   if person is null and length(trim(coalesce(command->>'email','')))>0 then
    perform pg_advisory_xact_lock(hashtextextended(lower(trim(command->>'email')),1));
    if (select count(*) from public.hr_people where lower(trim(email))=lower(trim(command->>'email')))>1 then raise exception 'Multiple people use this email. Review identity before importing.'; end if;
    select id into person from public.hr_people where lower(trim(email))=lower(trim(command->>'email'));
   end if;
  end if;
  if person is null then
   insert into public.hr_people(full_name,email,phone,headline,location,skills,languages,degrees,certifications,notes,source,owner_email,contact_allowed)
   values(command->>'full_name',coalesce(command->>'email',''),coalesce(command->>'phone',''),coalesce(command->>'headline',''),coalesce(command->>'location',''),coalesce(command->>'skills',''),coalesce(command->>'languages',''),coalesce(command->>'degrees',''),coalesce(command->>'certifications',''),coalesce(command->>'notes',''),coalesce(command->>'source',command->>'external_source','other'),coalesce(command->>'owner_email',actor_email),coalesce((command->>'contact_allowed')::boolean,true)) returning id,version into person,source_version;
   created:=true;
  else
   select * into p from public.hr_people where id=person for update;
   update public.hr_people set full_name=command->>'full_name', email=coalesce(command->>'email',email),phone=coalesce(command->>'phone',phone),headline=coalesce(command->>'headline',headline),skills=coalesce(command->>'skills',skills),languages=coalesce(command->>'languages',languages),degrees=coalesce(command->>'degrees',degrees),certifications=coalesce(command->>'certifications',certifications),notes=coalesce(command->>'notes',notes),version=version+1,updated_at=now() where id=person returning version into source_version;
  end if;
  if kind='import_person' then
   insert into public.hr_person_external_ids(external_source,external_id,person_id) values(command->>'external_source',command->>'external_id',person) on conflict do nothing;
   if command ? 'employment' and jsonb_typeof(command->'employment')='object' then
    if not private.is_admin() then raise exception 'Only administrators can import historical employment.'; end if;
    startday:=(command#>>'{employment,start_date}')::date; endday:=nullif(command#>>'{employment,end_date}','')::date;
     if startday is null then raise exception 'Historical employment requires its actual start date.'; end if;
     select id into emp from public.employees where person_id=person and start_date=startday;
     if emp is null then
      if exists(select 1 from public.employees where person_id=person and coalesce(end_date,'infinity'::date)>=startday and start_date<=coalesce(endday,'infinity'::date)) then raise exception 'Historical employment overlaps an existing employment period.'; end if;
     insert into public.employees(person_id,role,start_date,end_date,status,onboarding_completed_at,probation_status)
     values(person,coalesce(command#>>'{employment,role}',''),startday,endday,case when endday is not null then 'ended' when startday>current_date then 'preboarding' else 'active' end,case when startday<=current_date then now() else null end,case when endday is not null then 'ended' when startday>current_date then 'pending' else 'confirmed' end) returning id into emp;
     if startday>current_date and endday is null then insert into public.onboarding_items(employee_id,phase,title,assignee,due_date) values(emp,'preboarding','Verify imported employment documents and arrange access',actor_email,startday-1),(emp,'onboarding','Welcome and confirm first project plan',actor_email,startday); end if;
    end if;
   end if;
  end if;
  result:=result||jsonb_build_object('created',created,'version',source_version);
 when 'update_person' then
  perform private.hr_version(p.version,command->'expected_version');
  update public.hr_people set full_name=command->>'full_name',email=coalesce(command->>'email',email),phone=coalesce(command->>'phone',phone),headline=coalesce(command->>'headline',headline),location=coalesce(command->>'location',location),skills=coalesce(command->>'skills',skills),languages=coalesce(command->>'languages',languages),degrees=coalesce(command->>'degrees',degrees),certifications=coalesce(command->>'certifications',certifications),notes=coalesce(command->>'notes',notes),source=coalesce(command->>'source',source),owner_email=coalesce(command->>'owner_email',owner_email),contact_allowed=coalesce((command->>'contact_allowed')::boolean,contact_allowed),version=version+1,updated_at=now() where id=person returning version into source_version;
  update public.hr_ai_suggestions set status='stale' where person_id=person and status='draft';
  result:=result||jsonb_build_object('version',source_version);
 when 'link_account' then
  if person is null then raise exception 'Person required.'; end if;
  insert into public.hr_person_accounts(profile_id,person_id,linked_by) values((command->>'profile_id')::uuid,person,actor);
 when 'create_application' then
  if person is null then raise exception 'Person required.'; end if;
  select * into opp from public.opportunities where id=(command->>'opportunity_id')::uuid for update;
  if not found or opp.status not in ('approved','published') then raise exception 'Select an approved or published requisition.'; end if;
  insert into public.hr_applications(person_id,opportunity_id,source,referrer) values(person,opp.id,coalesce(command->>'source',p.source),coalesce(command->>'referrer','')) returning id,version into app,source_version;
  nxt:='application';result:=result||jsonb_build_object('version',source_version);
 when 'move_application' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' then raise exception 'Only active applications can move.'; end if;
  reqs:=public.hr_application_requirements(app,command->>'to_stage');
  if exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Complete the required evidence before moving: %', (select string_agg(j->>'label',', ') from jsonb_array_elements(reqs) j where not (j->>'done')::boolean); end if;
  prev:=a.stage;nxt:=command->>'to_stage';
  if prev=nxt then raise exception 'Application is already in this stage.'; end if;
  update public.hr_applications set stage=nxt,stage_entered_at=now(),version=version+1,updated_at=now() where id=app returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'dispose_application' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' or command->>'status' not in ('rejected','withdrawn') or length(trim(coalesce(command->>'reason','')))=0 then raise exception 'An active application and disposition reason are required.'; end if;
  prev:=a.status;nxt:=command->>'status';
  update public.hr_applications set status=nxt,reason=command->>'reason',version=version+1,updated_at=now() where id=app returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'update_screening' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' then raise exception 'Application is no longer active.'; end if;
  update public.hr_applications set screening_summary=command->>'screening_summary',screening_recommendation=command->>'screening_recommendation',version=version+1,updated_at=now() where id=app returning version into source_version;
  update public.hr_ai_suggestions set status='stale' where application_id=app and status='draft';
  result:=result||jsonb_build_object('version',source_version);
 when 'add_note' then
  if person is null or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'A person and note are required.'; end if;
 when 'schedule_interview' then
  if app is null or a.status<>'active' then raise exception 'Select an active application.'; end if;
  insert into public.interviews(application_id,kind,scheduled_at,panel,location) values(app,command->>'interview_kind',(command->>'scheduled_at')::timestamptz,command->>'panel',coalesce(command->>'location','')) returning id into iid;
  result:=result||jsonb_build_object('interview_id',iid);
 when 'complete_interview','cancel_interview' then
  select * into i from public.interviews where id=(command->>'interview_id')::uuid for update;
  if not found then raise exception 'Interview not found.'; end if;
  perform private.hr_version(i.version,command->'expected_version');
  if i.status<>'scheduled' then raise exception 'Only scheduled interviews can be completed or cancelled.'; end if;
  if kind='complete_interview' then
   if jsonb_typeof(command->'scorecard')<>'array' or jsonb_array_length(command->'scorecard')=0 or length(trim(coalesce(command->>'notes','')))=0 then raise exception 'Interview notes and a completed scorecard are required.'; end if;
   if exists(select 1 from jsonb_array_elements(command->'scorecard') j where jsonb_typeof(j)<>'object' or jsonb_typeof(j->'rating') is distinct from 'number' or length(trim(coalesce(j->>'competency','')))=0 or (j->>'rating')::numeric not between 1 and 5 or length(trim(coalesce(j->>'evidence','')))=0) then raise exception 'Each scorecard entry needs a rating from 1 to 5 and evidence.'; end if;
   update public.interviews set status='completed',scorecard=command->'scorecard',notes=command->>'notes',version=version+1 where id=i.id;
  else
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Cancellation reason required.'; end if;
   update public.interviews set status='cancelled',version=version+1 where id=i.id;
  end if;
  result:=result||jsonb_build_object('interview_id',i.id,'version',i.version+1);
 when 'create_offer' then
  if app is null or a.status<>'active' then raise exception 'Select an active application.'; end if;
  reqs:=public.hr_application_requirements(app,'decision');
  if a.stage not in ('decision','offer','contract') or exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Record a recruitment decision and complete interview evidence before drafting an offer.'; end if;
  insert into public.offers(application_id,title,contract_type,salary_monthly,cjm,target_tjm,valid_until) values(app,command->>'title',command->>'contract_type',(command->>'salary_monthly')::numeric,(command->>'cjm')::numeric,(command->>'target_tjm')::numeric,nullif(command->>'valid_until','')::date) returning id into oid;
  result:=result||jsonb_build_object('offer_id',oid,'version',1);
 when 'approve_offer','share_offer','respond_offer','cancel_offer' then
  select * into o from public.offers where id=(command->>'offer_id')::uuid for update;
  if not found then raise exception 'Offer not found.'; end if;
  perform private.hr_version(o.version,command->'expected_version'); prev:=o.status;
  if a.status<>'active' then raise exception 'Application is no longer active.'; end if;
  if kind='cancel_offer' then
   if o.status not in ('draft','pending_approval','pending_direction','approved','shared','accepted') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open offer and cancellation rationale are required.'; end if;
   nxt:='cancelled';update public.offers set status=nxt,version=version+1 where id=o.id;
  elsif kind='approve_offer' then
   if length(trim(coalesce(command->>'note','')))=0 then raise exception 'Approval note required.'; end if;
   if o.status='pending_direction' then
    if not private.is_admin() then raise exception 'Administrator direction approval required.'; end if;
    authority:='direction';nxt:='approved';
   elsif o.status='pending_approval' then
    authority:='hr';nxt:=case when o.margin_pct between 25 and 40 then 'approved' else 'pending_direction' end;
   else raise exception 'Offer is not awaiting approval.'; end if;
   insert into public.offer_approvals(offer_id,actor_id,authority,note) values(o.id,actor,authority,command->>'note');
   update public.offers set status=nxt,approver_note=command->>'note',decided_by=actor_email,version=version+1 where id=o.id;
  elsif kind='share_offer' then
   if o.status<>'approved' then raise exception 'Only approved offers can be shared.'; end if;
   if not exists(select 1 from public.hr_person_accounts where person_id=person) then raise exception 'Link a portal account before sharing this offer.'; end if;
   if o.valid_until is not null and o.valid_until<current_date then raise exception 'Offer has expired.'; end if;
   nxt:='shared';update public.offers set status=nxt,shared_at=now(),version=version+1 where id=o.id;
  else
   if o.status<>'shared' or command->>'response' not in ('accepted','declined') then raise exception 'Only shared offers can receive an acceptance or decline.'; end if;
   if o.valid_until is not null and o.valid_until<current_date then raise exception 'Offer has expired.'; end if;
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Response evidence is required.'; end if;
   nxt:=command->>'response';update public.offers set status=nxt,response_at=now(),version=version+1 where id=o.id;
  end if;
  result:=result||jsonb_build_object('offer_id',o.id,'version',o.version+1);
 when 'hire' then
  perform private.hr_version(a.version,command->'expected_version');
  reqs:=public.hr_application_requirements(app,'hire');
  if exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Hire prerequisites: %', (select string_agg(j->>'label',', ') from jsonb_array_elements(reqs) j where not (j->>'done')::boolean); end if;
  if length(trim(coalesce(command->>'role','')))=0 then raise exception 'Employment role is required.'; end if;
  if a.status<>'active' or a.stage<>'contract' then raise exception 'Move the active application to Contract before hiring.'; end if;
  select * into o from public.offers where application_id=app and status='accepted' order by created_at desc limit 1;
  if not found then raise exception 'An accepted offer is required.'; end if;
  if not exists(select 1 from public.contracts c join public.contract_signatures candidate_sig on candidate_sig.contract_id=c.id and candidate_sig.document_sha256=c.document_sha256 join public.contract_countersignatures cs on cs.contract_id=c.id and cs.document_sha256=c.document_sha256 where c.application_id=app and c.person_id=person and c.offer_id=o.id) then raise exception 'A linked contract signed by the candidate and employer is required.'; end if;
  if exists(select 1 from public.employees where person_id=person and status<>'ended') then raise exception 'This person already has an open employment period.'; end if;
  startday:=(command->>'start_date')::date;
  if exists(select 1 from public.employees where person_id=person and end_date>=startday) then raise exception 'A rehire must start after the previous employment period ended.'; end if;
  insert into public.employees(person_id,application_id,offer_id,role,manager_email,parrain,start_date,probation_end)
  values(person,app,o.id,command->>'role',coalesce(command->>'manager_email',''),coalesce(command->>'parrain',''),startday,nullif(command->>'probation_end','')::date) returning id into emp;
  insert into public.onboarding_items(employee_id,phase,title,assignee,due_date) values
  (emp,'preboarding','Verify employment documents',actor_email,startday-3),
  (emp,'preboarding','Prepare equipment and access',actor_email,startday-1),
  (emp,'onboarding','Welcome and team introduction',coalesce(command->>'manager_email',actor_email),startday),
  (emp,'onboarding','Confirm role and first project plan',coalesce(command->>'manager_email',actor_email),startday+7);
  if nullif(command->>'probation_end','') is not null then insert into public.reviews(employee_id,kind,due_date) values(emp,'probation',(command->>'probation_end')::date-7); end if;
  prev:=a.status;nxt:='hired';update public.hr_applications set status='hired',version=version+1,updated_at=now() where id=app;
  update public.contracts set employee_id=emp where application_id=app;
  result:=result||jsonb_build_object('version',a.version+1);
 when 'start_onboarding','complete_onboarding' then
  perform private.hr_version(e.version,command->'expected_version');
  if kind='start_onboarding' then
   if e.status<>'preboarding' then raise exception 'Only preboarding employment can start onboarding.'; end if;
   if e.start_date>current_date then raise exception 'Onboarding starts on or after the employment start date.'; end if;
   if exists(select 1 from public.onboarding_items where employee_id=emp and phase='preboarding' and required and completed_at is null) then raise exception 'Complete required preboarding tasks first.'; end if;
   prev:=e.status;nxt:='active';update public.employees set status='active',version=version+1,updated_at=now() where id=emp;
  else
   if e.status<>'active' or e.onboarding_completed_at is not null then raise exception 'Only active unfinished onboarding can be completed.'; end if;
   if exists(select 1 from public.onboarding_items where employee_id=emp and phase in ('preboarding','onboarding') and required and completed_at is null) then raise exception 'Complete required onboarding tasks first.'; end if;
   update public.employees set onboarding_completed_at=now(),version=version+1,updated_at=now() where id=emp;nxt:='onboarding_completed';
  end if;
  result:=result||jsonb_build_object('version',e.version+1);
 when 'update_employment' then
  perform private.hr_version(e.version,command->'expected_version');
  update public.employees set manager_email=coalesce(command->>'manager_email',manager_email),parrain=coalesce(command->>'parrain',parrain),version=version+1,updated_at=now() where id=emp returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'cancel_hire' then
  perform private.hr_version(e.version,command->'expected_version');
  if e.status<>'preboarding' or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Only preboarding employment can be cancelled, with a renunciation rationale.'; end if;
  if exists(select 1 from public.offboarding_records where employee_id=emp and status='open') then raise exception 'An open exit already exists for this employment.'; end if;
  update public.employee_project_assignments set status='cancelled',version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');
  if e.application_id is not null then
   update public.offers set status='cancelled',version=version+1 where application_id=e.application_id and status in ('pending_approval','pending_direction','approved','shared','accepted');
   update public.hr_applications set status='withdrawn',reason=command->>'rationale',version=version+1,updated_at=now() where id=e.application_id and status='hired';
  end if;
  prev:=e.status;nxt:='ended';
  update public.employees set status='ended',end_date=start_date,probation_status=case when probation_status='pending' then 'ended' else probation_status end,version=version+1,updated_at=now() where id=emp;
  result:=result||jsonb_build_object('version',e.version+1);
 when 'save_task' then
  if emp is null or e.status='ended' then raise exception 'Select an open employment period.'; end if;
  if nullif(command->>'dependency_id','') is not null and not exists(select 1 from public.onboarding_items where id=(command->>'dependency_id')::uuid and employee_id=emp) then raise exception 'Task dependency must belong to the same employment.'; end if;
  if command ? 'task_id' then
   select * into t from public.onboarding_items where id=(command->>'task_id')::uuid for update;
   perform private.hr_version(t.version,command->'expected_version');
   if t.completed_at is not null then raise exception 'Completed tasks retain their evidence.'; end if;
   if nullif(command->>'dependency_id','') is not null and exists(with recursive deps as(select id,dependency_id from public.onboarding_items where id=(command->>'dependency_id')::uuid union select dependency_record.id,dependency_record.dependency_id from public.onboarding_items dependency_record join deps d on dependency_record.id=d.dependency_id) select 1 from deps where id=t.id) then raise exception 'Task dependencies cannot form a cycle.'; end if;
   update public.onboarding_items set phase=command->>'phase',title=command->>'title',assignee=command->>'assignee',due_date=nullif(command->>'due_date','')::date,required=coalesce((command->>'required')::boolean,true),dependency_id=nullif(command->>'dependency_id','')::uuid,evidence=coalesce(command->>'evidence',''),version=version+1 where id=t.id returning id,version into item,source_version;
  else
   insert into public.onboarding_items(employee_id,phase,title,assignee,due_date,required,dependency_id,evidence) values(emp,command->>'phase',command->>'title',command->>'assignee',nullif(command->>'due_date','')::date,coalesce((command->>'required')::boolean,true),nullif(command->>'dependency_id','')::uuid,coalesce(command->>'evidence','')) returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('task_id',item,'version',source_version);
 when 'complete_task' then
  select * into t from public.onboarding_items where id=(command->>'task_id')::uuid for update;
  if not found then raise exception 'Task not found.'; end if;
  perform private.hr_version(t.version,command->'expected_version');
  if e.status='ended' or t.completed_at is not null then raise exception 'Task cannot be completed in its current state.'; end if;
  if not private.hr_operator() and lower(t.assignee) not in (lower(actor_email),'employee','candidate') then raise exception 'This task is assigned to someone else.'; end if;
  if t.dependency_id is not null and not exists(select 1 from public.onboarding_items where id=t.dependency_id and completed_at is not null) then raise exception 'Complete the dependent task first.'; end if;
  if length(trim(coalesce(command->>'evidence','')))=0 then raise exception 'Task completion evidence required.'; end if;
  update public.onboarding_items set evidence=command->>'evidence',completed_at=now(),completed_by=actor,version=version+1 where id=t.id;
  result:=result||jsonb_build_object('task_id',t.id,'version',t.version+1);
 when 'schedule_review' then
  if emp is null or e.status='ended' then raise exception 'Select an open employment period.'; end if;
  insert into public.reviews(employee_id,kind,due_date) values(emp,command->>'review_kind',(command->>'due_date')::date) returning id into item;
  result:=result||jsonb_build_object('review_id',item,'version',1);
 when 'record_review' then
  select * into r from public.reviews where id=(command->>'review_id')::uuid for update;
  if not found then raise exception 'Review not found.'; end if;
  perform private.hr_version(r.version,command->'expected_version');
  if r.status<>'scheduled' or e.status='ended' or length(trim(coalesce(command->>'rationale','')))=0 or length(trim(coalesce(command->>'outcome','')))=0 then raise exception 'A scheduled review, outcome and rationale are required.'; end if;
  if r.kind='probation' and command->>'outcome' not in ('confirmed','extended','ended') then raise exception 'Probation outcome must be confirmed, extended or ended.'; end if;
  if r.kind='probation' and command->>'outcome'='extended' and ((command->>'probation_end')::date is null or (command->>'probation_end')::date<=coalesce(e.probation_end,e.start_date)) then raise exception 'A later probation end date is required.'; end if;
  update public.reviews set status='held',outcome=command->>'outcome',rationale=command->>'rationale',held_at=now(),version=version+1 where id=r.id;
  if r.kind='probation' then update public.employees set probation_status=command->>'outcome',probation_end=coalesce(nullif(command->>'probation_end','')::date,probation_end),version=version+1,updated_at=now() where id=emp; end if;
  result:=result||jsonb_build_object('review_id',r.id,'version',r.version+1);
 when 'open_exit' then
  perform private.hr_version(e.version,command->'expected_version');
  if e.status not in ('preboarding','active') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open employment period and departure reason are required.'; end if;
  endday:=(command->>'exit_date')::date;
  if endday<e.start_date then raise exception 'Exit cannot precede employment start.'; end if;
  insert into public.offboarding_records(employee_id,kind,exit_date,notice_end) values(emp,command->>'exit_kind',endday,nullif(command->>'notice_end','')::date) returning id into xid;
  insert into public.offboarding_items(offboarding_id,title) values(xid,'Project handover recorded'),(xid,'Return equipment and close access'),(xid,'Deliver legal exit documents');
  prev:=e.status;nxt:='offboarding';update public.employees set status=nxt,planned_exit_date=endday,version=version+1,updated_at=now() where id=emp;
  result:=result||jsonb_build_object('exit_id',xid,'version',1);
 when 'save_exit','complete_exit' then
  select * into x from public.offboarding_records where id=(command->>'exit_id')::uuid for update;
  if not found then raise exception 'Exit not found.'; end if;
  perform private.hr_version(x.version,command->'expected_version');
  if x.status<>'open' then raise exception 'Exit is already completed.'; end if;
  if kind='save_exit' then
   update public.offboarding_records set handover_plan=command->>'handover_plan',successor=command->>'successor',exit_interview=command->>'exit_interview',rehire_eligible=(command->>'rehire_eligible')::boolean,rehire_rationale=command->>'rehire_rationale',legal_docs_evidence=command->>'legal_docs_evidence',version=version+1 where id=x.id;
  else
   if x.exit_date>current_date then raise exception 'Exit can be completed on or after its departure date.'; end if;
   if length(trim(x.handover_plan))=0 or length(trim(x.legal_docs_evidence))=0 or x.rehire_eligible is null or length(trim(x.rehire_rationale))=0 then raise exception 'Record handover, legal-document evidence and rehire decision before completing the exit.'; end if;
   if exists(select 1 from public.offboarding_items where offboarding_id=x.id and required and completed_at is null) then raise exception 'Complete required exit tasks first.'; end if;
   update public.offboarding_records set status='completed',completed_at=now(),version=version+1 where id=x.id;
   update public.employee_project_assignments set status=case when start_date>x.exit_date then 'cancelled' else 'completed' end,end_date=case when start_date>x.exit_date then end_date else least(coalesce(end_date,x.exit_date),x.exit_date) end,version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');
   update public.employees set status='ended',end_date=x.exit_date,probation_status=case when probation_status='pending' then 'ended' else probation_status end,version=version+1,updated_at=now() where id=emp;
   prev:=e.status;nxt:='ended';
  end if;
  result:=result||jsonb_build_object('exit_id',x.id,'version',x.version+1);
 when 'save_exit_item','complete_exit_item' then
  select * into x from public.offboarding_records where employee_id=emp and status='open' for update;
  if not found then raise exception 'Open exit not found.'; end if;
  if command ? 'item_id' then
   select * into xi from public.offboarding_items where id=(command->>'item_id')::uuid for update;
   if not found then raise exception 'Exit task not found.'; end if;
   perform private.hr_version(xi.version,command->'expected_version');
   if xi.completed_at is not null then raise exception 'Completed exit tasks retain their evidence.'; end if;
   if kind='complete_exit_item' then
    if length(trim(coalesce(command->>'evidence','')))=0 then raise exception 'Exit task evidence required.'; end if;
    update public.offboarding_items set evidence=command->>'evidence',completed_at=now(),version=version+1 where id=xi.id;
   else
    update public.offboarding_items set title=command->>'title',required=coalesce((command->>'required')::boolean,true),evidence=coalesce(command->>'evidence',''),version=version+1 where id=xi.id;
   end if;item:=xi.id;source_version:=xi.version+1;
  else
   insert into public.offboarding_items(offboarding_id,title,required,evidence) values(x.id,command->>'title',coalesce((command->>'required')::boolean,true),coalesce(command->>'evidence','')) returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('item_id',item,'version',source_version);
 when 'assign_project','update_assignment' then
  if kind='update_assignment' then
   select * into ass from public.employee_project_assignments where id=(command->>'assignment_id')::uuid for update;
   if not found then raise exception 'Assignment not found.'; end if;
   perform private.hr_version(ass.version,command->'expected_version');
   if ass.status in ('completed','cancelled') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open assignment and change rationale are required.'; end if;
   if ass.status in ('reserved','confirmed','active') and ass.start_date<=current_date and command->>'status'='proposed' then raise exception 'A started commitment cannot return to proposed status.'; end if;
   oid:=ass.project_id;
  else oid:=(command->>'project_id')::uuid; end if;
  if emp is null or e.status not in ('preboarding','active') then raise exception 'Projects require an open employment period outside offboarding.'; end if;
  startday:=(command->>'start_date')::date;endday:=nullif(command->>'end_date','')::date;
  perform project_record.id from public.sales_projects project_record where project_record.id=oid for share;
  if not found then raise exception 'Project not found.'; end if;
  if exists(select 1 from public.sales_projects where id=oid and ((start_date is not null and startday<start_date) or (end_date is not null and (endday is null or endday>end_date)))) then raise exception 'Assignment dates must fit the project window.'; end if;
  if startday<e.start_date or (e.planned_exit_date is not null and (endday is null or endday>e.planned_exit_date)) then raise exception 'Assignment dates must fit employment dates.'; end if;
  if command->>'status'='active' and startday>current_date then raise exception 'Active assignment cannot start in the future.'; end if;
  if command->>'status' not in ('proposed','reserved','confirmed','active') then raise exception 'Invalid assignment status.'; end if;
  if nullif(command->>'pricing_line','') is not null and not exists(select 1 from public.sales_projects pricing_source where pricing_source.id=oid and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(pricing_source.tjm_profiles)='array' then pricing_source.tjm_profiles else '[]'::jsonb end) pricing_candidate where pricing_candidate->>'name'=command->>'pricing_line')) then raise exception 'Unknown pricing line for this project.'; end if;
  if command->>'status'<>'proposed' and exists(
   with boundaries as (select startday as day union select start_date from public.employee_project_assignments where employee_id=emp and id is distinct from ass.id and status in ('reserved','confirmed','active','completed') and start_date>=startday and start_date<=coalesce(endday,'infinity'::date))
   select 1 from boundaries b where (command->>'allocation_pct')::integer+coalesce((select sum(allocation_pct) from public.employee_project_assignments capacity_record where capacity_record.employee_id=emp and capacity_record.id is distinct from ass.id and capacity_record.status in ('reserved','confirmed','active','completed') and capacity_record.start_date<=b.day and coalesce(capacity_record.end_date,'infinity'::date)>=b.day),0)>100
  ) then raise exception 'Assignment exceeds 100%% capacity during the requested dates.'; end if;
  if kind='update_assignment' then
   update public.employee_project_assignments set position=command->>'position',pricing_line=coalesce(nullif(command->>'pricing_line',''),ass.pricing_line),allocation_pct=(command->>'allocation_pct')::integer,start_date=startday,end_date=endday,status=command->>'status',version=version+1,updated_at=now() where id=ass.id returning id,version into item,source_version;
  else
   insert into public.employee_project_assignments(employee_id,project_id,position,pricing_line,allocation_pct,start_date,end_date,status) values(emp,oid,command->>'position',coalesce(nullif(command->>'pricing_line',''),''),(command->>'allocation_pct')::integer,startday,endday,command->>'status') returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('assignment_id',item,'version',source_version);
 when 'end_assignment' then
  select * into ass from public.employee_project_assignments where id=(command->>'assignment_id')::uuid for update;
  if not found then raise exception 'Assignment not found.'; end if;
  perform private.hr_version(ass.version,command->'expected_version');
  if ass.status in ('completed','cancelled') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open assignment and closing reason are required.'; end if;
  if coalesce((command->>'cancel')::boolean,false) and ass.status<>'proposed' and ass.start_date<=current_date then raise exception 'Started commitments must be completed with their actual end date, rather than cancelled.'; end if;
  endday:=(command->>'end_date')::date;
  if not coalesce((command->>'cancel')::boolean,false) and endday>current_date then raise exception 'Complete assignments on or after their actual end date. Cancel to release a future reservation.'; end if;
  if not coalesce((command->>'cancel')::boolean,false) and (endday<ass.start_date or (ass.end_date is not null and endday>ass.end_date)) then raise exception 'Completion must fall within the assignment window.'; end if;
  update public.employee_project_assignments set status=case when coalesce((command->>'cancel')::boolean,false) then 'cancelled' else 'completed' end,end_date=case when coalesce((command->>'cancel')::boolean,false) then end_date else endday end,version=version+1,updated_at=now() where id=ass.id;
  result:=result||jsonb_build_object('assignment_id',ass.id,'version',ass.version+1);
 when 'create_requisition' then
  if command->>'hiring_mode'='sur_profil' and length(trim(coalesce(command->>'justification','')))=0 then raise exception 'Profile hiring justification is required.'; end if;
  insert into public.opportunities(title,hiring_mode,job_id,project_id,client_ids,client_need,skill_family,owner_email,target_tjm,justification,status,decided_by,decided_at)
  values(command->>'title',command->>'hiring_mode',nullif(command->>'job_id','')::uuid,nullif(command->>'project_id','')::uuid,coalesce(client_links,'{}'),coalesce(command->>'client_need',''),coalesce(command->>'skill_family',''),coalesce(command->>'owner_email',actor_email),nullif(command->>'target_tjm','')::numeric,coalesce(command->>'justification',''),'approved',actor_email,now()) returning id into oid;
  result:=result||jsonb_build_object('opportunity_id',oid,'version',1);
 when 'update_requisition','publish_requisition' then
  select * into opp from public.opportunities where id=(command->>'opportunity_id')::uuid for update;
  if not found then raise exception 'Requisition not found.'; end if;
  perform private.hr_version(opp.version,command->'expected_version');
  if kind='update_requisition' then
   if opp.status not in ('draft','pending_approval','approved') then raise exception 'Published or closed requisitions cannot be edited. Create a new one for changed requirements.'; end if;
   update public.opportunities set title=command->>'title',hiring_mode=command->>'hiring_mode',job_id=nullif(command->>'job_id','')::uuid,project_id=nullif(command->>'project_id','')::uuid,client_ids=coalesce(client_links,opp.client_ids),client_need=coalesce(command->>'client_need',''),skill_family=coalesce(command->>'skill_family',''),owner_email=coalesce(command->>'owner_email',actor_email),target_tjm=nullif(command->>'target_tjm','')::numeric,justification=coalesce(command->>'justification',''),version=version+1,updated_at=now() where id=opp.id;
  else
   if opp.status<>'approved' then raise exception 'Only approved requisitions can be published.'; end if;
   update public.jobs set published=true,updated_at=now() where id=(command->>'job_id')::uuid;
   if not found then raise exception 'Job post not found.'; end if;
   update public.opportunities set status='published',job_id=(command->>'job_id')::uuid,version=version+1,updated_at=now() where id=opp.id;
  end if;
  result:=result||jsonb_build_object('opportunity_id',opp.id,'version',opp.version+1);
 when 'countersign_contract' then
  select c.person_id,c.application_id,c.employee_id into person,app,emp from public.contracts c where c.id=(command->>'contract_id')::uuid for update;
  if person is null then raise exception 'Link the contract to a person and application first.'; end if;
  insert into public.contract_countersignatures(contract_id,actor_id,signer_name,document_sha256) select id,actor,command->>'signer_name',document_sha256 from public.contracts where id=(command->>'contract_id')::uuid;
 when 'save_suggestion' then
  if person is null and app is null and emp is null and nullif(command->>'opportunity_id','') is null then raise exception 'A suggestion target is required.'; end if;
  if app is not null and nullif(command->>'person_id','')::uuid is distinct from person then raise exception 'Suggestion application does not belong to selected person.'; end if;
  if emp is not null and nullif(command->>'person_id','')::uuid is distinct from person then raise exception 'Suggestion employment does not belong to selected person.'; end if;
  if person is not null and p.version<>(command->>'input_version')::integer then raise exception 'Suggestion sources changed. Generate it again.'; end if;
  if jsonb_typeof(command->'sources')<>'array' or jsonb_array_length(command->'sources')=0 then raise exception 'Evidence sources are required.'; end if;
  for evidence_source in select value from jsonb_array_elements(command->'sources') order by value->>'type',value->>'id' loop
   source_version:=null;
   case evidence_source->>'type'
   when 'person' then select version into source_version from public.hr_people where id=(evidence_source->>'id')::uuid and id=person;
   when 'application' then select version into source_version from public.hr_applications where id=(evidence_source->>'id')::uuid and person_id=person;
   when 'employee' then select version into source_version from public.employees where id=(evidence_source->>'id')::uuid and person_id=person;
   when 'task' then select source_record.version into source_version from public.onboarding_items source_record join public.employees source_employment on source_employment.id=source_record.employee_id where source_record.id=(evidence_source->>'id')::uuid and source_employment.person_id=person;
   when 'assignment' then select source_record.version into source_version from public.employee_project_assignments source_record join public.employees source_employment on source_employment.id=source_record.employee_id where source_record.id=(evidence_source->>'id')::uuid and source_employment.person_id=person;
   when 'project' then select version into source_version from public.sales_projects where id=(evidence_source->>'id')::uuid for share;
   when 'opportunity' then select version into source_version from public.opportunities where id=(evidence_source->>'id')::uuid for share;
   else raise exception 'Unknown suggestion evidence type.'; end case;
   if source_version is null or source_version is distinct from (evidence_source->>'version')::integer then raise exception 'Suggestion source changed or is outside this person. Generate it again.'; end if;
  end loop;
  insert into public.hr_ai_suggestions(person_id,application_id,employee_id,opportunity_id,kind,payload,sources,input_version,model) values(person,app,emp,nullif(command->>'opportunity_id','')::uuid,command->>'suggestion_kind',command->'payload',command->'sources',(command->>'input_version')::integer,command->>'model') returning id into sid;
  result:=result||jsonb_build_object('suggestion_id',sid);
 when 'review_suggestion' then
  select * into s from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid for update;
  if not found or s.status<>'draft' then raise exception 'Only draft suggestions can be reviewed; this suggestion may be stale.'; end if;
  person:=s.person_id;app:=s.application_id;emp:=s.employee_id;
  if command->>'status' not in ('accepted','dismissed') then raise exception 'Review must accept or dismiss.'; end if;
  if person is not null and not exists(select 1 from public.hr_people where id=person and version=s.input_version) then raise exception 'Suggestion is stale. Generate it again.'; end if;
  for evidence_source in select value from jsonb_array_elements(s.sources) order by value->>'type',value->>'id' loop
   source_version:=null;
   case evidence_source->>'type'
   when 'person' then select version into source_version from public.hr_people where id=(evidence_source->>'id')::uuid;
   when 'application' then select version into source_version from public.hr_applications where id=(evidence_source->>'id')::uuid;
   when 'employee' then select version into source_version from public.employees where id=(evidence_source->>'id')::uuid;
   when 'task' then select version into source_version from public.onboarding_items where id=(evidence_source->>'id')::uuid;
   when 'assignment' then select version into source_version from public.employee_project_assignments where id=(evidence_source->>'id')::uuid;
   when 'project' then select version into source_version from public.sales_projects where id=(evidence_source->>'id')::uuid for share;
   when 'opportunity' then select version into source_version from public.opportunities where id=(evidence_source->>'id')::uuid for share;
   else raise exception 'Unknown suggestion evidence.'; end case;
   if source_version is distinct from (evidence_source->>'version')::integer then raise exception 'Suggestion is stale. Generate it again.'; end if;
  end loop;
  update public.hr_ai_suggestions set status=command->>'status',reviewed_by=actor,reviewed_at=now() where id=s.id;
  result:=result||jsonb_build_object('suggestion_id',s.id);
 else raise exception 'Unknown HR command: %',kind;
 end case;
 if person is not null then
  insert into public.hr_events(person_id,application_id,employee_id,kind,previous_state,next_state,actor_id,actor_email,rationale,request_id)
  values(person,app,emp,kind,prev,nxt,actor,actor_email,coalesce(command->>'rationale',command->>'reason',command->>'note',''),request);
 end if;
 result:=result||jsonb_strip_nulls(jsonb_build_object('person_id',person,'application_id',app,'employee_id',emp));
 insert into public.hr_command_receipts(actor_id,request_id,command,result) values(actor,request,command,result);
 return result;
end;
$$;

notify pgrst, 'reload schema';

create or replace function public.hr_command(command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=private.workspace_user_id(); actor_email text; kind text:=command->>'kind'; request uuid:=(command->>'request_id')::uuid;
 allowed text[]; required_keys text[]; result jsonb; receipt public.hr_command_receipts; person uuid; app uuid; emp uuid; item uuid; oid uuid; iid uuid; xid uuid; sid uuid;
 i public.interviews; a public.hr_applications; e public.employees; o public.offers; r public.reviews; t public.onboarding_items; x public.offboarding_records; xi public.offboarding_items;
 ass public.employee_project_assignments; opp public.opportunities; s public.hr_ai_suggestions; p public.hr_people; sal public.employee_salaries;
 prev text:=''; nxt text:=''; reqs jsonb; authority text; startday date; endday date; evidence_source jsonb; source_version integer; created boolean:=false; client_links uuid[];
begin
 if actor is null or request is null then raise exception 'Authentication and request_id are required.'; end if;
 if jsonb_typeof(command)<>'object' then raise exception 'Command must be an object.'; end if;
 case kind
 when 'create_person' then allowed:=array['certifications','contact_allowed','degrees','email','full_name','headline','kind','languages','location','notes','owner_email','phone','request_id','skills','source']; required_keys:=array['full_name','kind','request_id'];
 when 'update_person' then allowed:=array['certifications','contact_allowed','degrees','email','expected_version','full_name','headline','kind','languages','location','notes','owner_email','person_id','phone','request_id','skills','source']; required_keys:=array['expected_version','full_name','kind','person_id','request_id'];
 when 'link_account' then allowed:=array['kind','person_id','profile_id','request_id']; required_keys:=array['kind','person_id','profile_id','request_id'];
 when 'create_application' then allowed:=array['kind','opportunity_id','person_id','referrer','request_id','source']; required_keys:=array['kind','opportunity_id','person_id','request_id'];
 when 'move_application' then allowed:=array['application_id','expected_version','kind','rationale','request_id','to_stage']; required_keys:=array['application_id','expected_version','kind','request_id','to_stage'];
 when 'dispose_application' then allowed:=array['application_id','expected_version','kind','reason','request_id','status']; required_keys:=array['application_id','expected_version','kind','reason','request_id','status'];
 when 'update_screening' then allowed:=array['application_id','expected_version','kind','request_id','screening_recommendation','screening_summary']; required_keys:=array['application_id','expected_version','kind','request_id','screening_recommendation','screening_summary'];
 when 'add_note' then allowed:=array['application_id','employee_id','kind','person_id','rationale','request_id']; required_keys:=array['kind','person_id','rationale','request_id'];
 when 'schedule_interview' then allowed:=array['application_id','interview_kind','kind','location','panel','request_id','scheduled_at']; required_keys:=array['application_id','interview_kind','kind','panel','request_id','scheduled_at'];
 when 'complete_interview' then allowed:=array['expected_version','interview_id','kind','notes','request_id','scorecard']; required_keys:=array['expected_version','interview_id','kind','notes','request_id','scorecard'];
 when 'cancel_interview' then allowed:=array['expected_version','interview_id','kind','rationale','request_id']; required_keys:=array['expected_version','interview_id','kind','rationale','request_id'];
 when 'create_offer' then allowed:=array['application_id','cjm','contract_type','kind','request_id','salary_monthly','target_tjm','title','valid_until']; required_keys:=array['application_id','cjm','contract_type','kind','request_id','salary_monthly','target_tjm','title'];
 when 'approve_offer' then allowed:=array['expected_version','kind','note','offer_id','request_id']; required_keys:=array['expected_version','kind','note','offer_id','request_id'];
 when 'cancel_offer' then allowed:=array['expected_version','kind','offer_id','rationale','request_id']; required_keys:=array['expected_version','kind','offer_id','rationale','request_id'];
 when 'share_offer' then allowed:=array['expected_version','kind','offer_id','request_id']; required_keys:=array['expected_version','kind','offer_id','request_id'];
 when 'respond_offer' then allowed:=array['expected_version','kind','offer_id','rationale','request_id','response']; required_keys:=array['expected_version','kind','offer_id','rationale','request_id','response'];
 when 'hire' then allowed:=array['application_id','expected_version','kind','manager_email','parrain','probation_end','request_id','role','start_date']; required_keys:=array['application_id','expected_version','kind','request_id','role','start_date'];
 when 'engage_person' then allowed:=array['contract_type','kind','manager_email','person_id','rationale','request_id','role','start_date']; required_keys:=array['contract_type','kind','person_id','request_id','role','start_date'];
 when 'start_onboarding' then allowed:=array['employee_id','expected_version','kind','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'complete_onboarding' then allowed:=array['employee_id','expected_version','kind','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'update_employment' then allowed:=array['employee_id','expected_version','kind','manager_email','parrain','request_id']; required_keys:=array['employee_id','expected_version','kind','request_id'];
 when 'cancel_hire' then allowed:=array['employee_id','expected_version','kind','rationale','request_id']; required_keys:=array['employee_id','expected_version','kind','rationale','request_id'];
 when 'save_salary' then allowed:=array['employee_id','end_date','expected_version','kind','rationale','request_id','salary_id','salary_monthly','start_date']; required_keys:=array['employee_id','kind','request_id','salary_monthly','start_date'];
 when 'save_task' then allowed:=array['assignee','dependency_id','due_date','employee_id','evidence','expected_version','kind','phase','request_id','required','task_id','title']; required_keys:=array['assignee','employee_id','kind','phase','request_id','title'];
 when 'complete_task' then allowed:=array['evidence','expected_version','kind','request_id','task_id']; required_keys:=array['evidence','expected_version','kind','request_id','task_id'];
 when 'schedule_review' then allowed:=array['due_date','employee_id','kind','request_id','review_kind']; required_keys:=array['due_date','employee_id','kind','request_id','review_kind'];
 when 'record_review' then allowed:=array['expected_version','kind','outcome','probation_end','rationale','request_id','review_id']; required_keys:=array['expected_version','kind','outcome','rationale','request_id','review_id'];
 when 'open_exit' then allowed:=array['employee_id','exit_date','exit_kind','expected_version','kind','notice_end','rationale','request_id']; required_keys:=array['employee_id','exit_date','exit_kind','expected_version','kind','rationale','request_id'];
 when 'save_exit' then allowed:=array['exit_id','exit_interview','expected_version','handover_plan','kind','rehire_eligible','rehire_rationale','request_id','successor']; required_keys:=array['exit_id','exit_interview','expected_version','handover_plan','kind','rehire_eligible','rehire_rationale','request_id','successor'];
 when 'complete_exit' then allowed:=array['exit_id','expected_version','kind','request_id']; required_keys:=array['exit_id','expected_version','kind','request_id'];
 when 'save_exit_item' then allowed:=array['exit_id','expected_version','item_id','kind','request_id','required','title']; required_keys:=array['exit_id','kind','request_id','title'];
 when 'complete_exit_item' then allowed:=array['expected_version','item_id','kind','request_id']; required_keys:=array['expected_version','item_id','kind','request_id'];
 when 'assign_project' then allowed:=array['allocation_pct','employee_id','end_date','kind','position','pricing_line','project_id','request_id','start_date','status']; required_keys:=array['allocation_pct','employee_id','kind','position','project_id','request_id','start_date','status'];
 when 'update_assignment' then allowed:=array['allocation_pct','assignment_id','end_date','expected_version','kind','position','pricing_line','rationale','request_id','start_date','status']; required_keys:=array['allocation_pct','assignment_id','expected_version','kind','position','rationale','request_id','start_date','status'];
 when 'end_assignment' then allowed:=array['assignment_id','cancel','end_date','expected_version','kind','rationale','request_id']; required_keys:=array['assignment_id','end_date','expected_version','kind','rationale','request_id'];
 when 'create_requisition' then allowed:=array['client_ids','client_need','hiring_mode','job_id','justification','kind','owner_email','project_id','request_id','skill_family','target_tjm','title']; required_keys:=array['hiring_mode','kind','request_id','title'];
 when 'update_requisition' then allowed:=array['client_ids','client_need','expected_version','hiring_mode','job_id','justification','kind','opportunity_id','owner_email','project_id','request_id','skill_family','target_tjm','title']; required_keys:=array['expected_version','hiring_mode','kind','opportunity_id','request_id','title'];
 when 'publish_requisition' then allowed:=array['expected_version','job_id','kind','opportunity_id','request_id']; required_keys:=array['expected_version','job_id','kind','opportunity_id','request_id'];
 when 'countersign_contract' then allowed:=array['contract_id','kind','request_id','signer_name']; required_keys:=array['contract_id','kind','request_id','signer_name'];
 when 'save_suggestion' then allowed:=array['application_id','employee_id','input_version','kind','model','opportunity_id','payload','person_id','request_id','sources','suggestion_kind']; required_keys:=array['input_version','kind','model','payload','request_id','sources','suggestion_kind'];
 when 'review_suggestion' then allowed:=array['kind','request_id','status','suggestion_id']; required_keys:=array['kind','request_id','status','suggestion_id'];
 when 'import_person' then allowed:=array['certifications','contact_allowed','degrees','email','employment','external_id','external_source','full_name','headline','kind','languages','location','notes','owner_email','phone','rationale','request_id','skills','source']; required_keys:=array['external_id','external_source','full_name','kind','rationale','request_id'];
 else raise exception 'Unknown HR command: %',kind;
 end case;
 if exists(select 1 from jsonb_object_keys(command) k where not (k=any(allowed))) then raise exception 'Unexpected fields for HR command %.',kind; end if;
 if exists(select 1 from unnest(required_keys) k where not (command ? k)) then raise exception 'Missing required fields for HR command %.',kind; end if;
 if command ? 'client_ids' then
  if jsonb_typeof(command->'client_ids')<>'array' then raise exception 'Client links must be an array of client identifiers.'; end if;
  client_links:=coalesce((select array_agg(distinct v::uuid order by v::uuid) from jsonb_array_elements_text(command->'client_ids') v),'{}');
  if exists(select 1 from unnest(client_links) c(id) where not exists(select 1 from public.sales_clients where id=c.id)) then raise exception 'Unknown client link.'; end if;
 end if;
 select email into actor_email from public.profiles where id=actor;
 if actor_email is null then raise exception 'Workspace account not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request::text,0));
 select * into receipt from public.hr_command_receipts where actor_id=actor and request_id=request;
 if found then
  if receipt.command<>command then raise exception 'This request ID was already used for another command.'; end if;
  return receipt.result;
 end if;
 if not private.hr_operator() and not (private.hr_staffer() and kind in ('assign_project','update_assignment','end_assignment')) and kind not in ('respond_offer','complete_task') then raise exception 'HR access required.'; end if;
 person:=nullif(command->>'person_id','')::uuid; app:=nullif(command->>'application_id','')::uuid; emp:=nullif(command->>'employee_id','')::uuid;
 if command ? 'suggestion_id' then select person_id,application_id,employee_id into person,app,emp from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid; end if;
 if command ? 'contract_id' then select person_id,application_id,employee_id into person,app,emp from public.contracts where id=(command->>'contract_id')::uuid; end if;
 if command ? 'interview_id' then select application_id into app from public.interviews where id=(command->>'interview_id')::uuid; end if;
 if command ? 'offer_id' then select application_id into app from public.offers where id=(command->>'offer_id')::uuid; end if;
 if command ? 'task_id' then select employee_id into emp from public.onboarding_items where id=(command->>'task_id')::uuid; end if;
 if command ? 'review_id' then select employee_id into emp from public.reviews where id=(command->>'review_id')::uuid; end if;
 if command ? 'exit_id' then select employee_id into emp from public.offboarding_records where id=(command->>'exit_id')::uuid; end if;
 if command ? 'assignment_id' then select employee_id into emp from public.employee_project_assignments where id=(command->>'assignment_id')::uuid; end if;
 if command ? 'item_id' then select exit_root.employee_id into emp from public.offboarding_records exit_root join public.offboarding_items exit_item on exit_item.offboarding_id=exit_root.id where exit_item.id=(command->>'item_id')::uuid; end if;
 if command ? 'salary_id' then select employee_id into emp from public.employee_salaries where id=(command->>'salary_id')::uuid; end if;
 if app is not null then select person_id into person from public.hr_applications where id=app; end if;
 if emp is not null then select person_id into person from public.employees where id=emp; end if;
 if person is not null then select * into p from public.hr_people where id=person for update; if not found then raise exception 'Person not found.'; end if; end if;
 if app is not null then select * into a from public.hr_applications where id=app for update; if not found then raise exception 'Application not found.'; end if; end if;
 if emp is not null then select * into e from public.employees where id=emp for update; if not found then raise exception 'Employment not found.'; end if; end if;
 if app is not null and emp is not null and a.person_id is distinct from e.person_id then raise exception 'Application and employment belong to different people.'; end if;
 if nullif(command->>'person_id','') is not null and person is distinct from (command->>'person_id')::uuid then raise exception 'Record does not belong to selected person.'; end if;
 if nullif(command->>'application_id','') is not null and app is distinct from (command->>'application_id')::uuid then raise exception 'Record does not belong to selected application.'; end if;
 if nullif(command->>'employee_id','') is not null and emp is distinct from (command->>'employee_id')::uuid then raise exception 'Record does not belong to selected employment.'; end if;
 if kind='review_suggestion' then
  select * into s from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid;
  perform req_source.id from public.opportunities req_source where req_source.id in (select (j->>'id')::uuid from jsonb_array_elements(s.sources) j where j->>'type'='opportunity') order by req_source.id for share;
  perform pr.id from public.sales_projects pr where pr.id in (select (j->>'id')::uuid from jsonb_array_elements(s.sources) j where j->>'type'='project') order by pr.id for share;
 end if;
 if not private.hr_operator() and kind='respond_offer' and not exists(select 1 from public.hr_person_accounts where profile_id=actor and person_id=person) then raise exception 'Offer not available to this account.'; end if;
 if not private.hr_operator() and kind='complete_task' and not exists(select 1 from public.hr_person_accounts where profile_id=actor and person_id=person) then raise exception 'Task not available to this account.'; end if;
 result:=jsonb_build_object('request_id',request);
 case kind
 when 'create_person','import_person' then
  if kind='import_person' then
   if length(trim(coalesce(command->>'external_source','')))=0 or length(trim(coalesce(command->>'external_id','')))=0 or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Import source, identity and rationale are required.'; end if;
   perform pg_advisory_xact_lock(hashtextextended(command->>'external_source'||':'||(command->>'external_id'),0));
   select person_id into person from public.hr_person_external_ids where external_source=command->>'external_source' and external_id=command->>'external_id';
   if person is null and length(trim(coalesce(command->>'email','')))>0 then
    perform pg_advisory_xact_lock(hashtextextended(lower(trim(command->>'email')),1));
    if (select count(*) from public.hr_people where lower(trim(email))=lower(trim(command->>'email')))>1 then raise exception 'Multiple people use this email. Review identity before importing.'; end if;
    select id into person from public.hr_people where lower(trim(email))=lower(trim(command->>'email'));
   end if;
  end if;
  if person is null then
   insert into public.hr_people(full_name,email,phone,headline,location,skills,languages,degrees,certifications,notes,source,owner_email,contact_allowed)
   values(command->>'full_name',coalesce(command->>'email',''),coalesce(command->>'phone',''),coalesce(command->>'headline',''),coalesce(command->>'location',''),coalesce(command->>'skills',''),coalesce(command->>'languages',''),coalesce(command->>'degrees',''),coalesce(command->>'certifications',''),coalesce(command->>'notes',''),coalesce(command->>'source',command->>'external_source','other'),coalesce(command->>'owner_email',actor_email),coalesce((command->>'contact_allowed')::boolean,true)) returning id,version into person,source_version;
   created:=true;
  else
   select * into p from public.hr_people where id=person for update;
   update public.hr_people set full_name=command->>'full_name', email=coalesce(command->>'email',email),phone=coalesce(command->>'phone',phone),headline=coalesce(command->>'headline',headline),skills=coalesce(command->>'skills',skills),languages=coalesce(command->>'languages',languages),degrees=coalesce(command->>'degrees',degrees),certifications=coalesce(command->>'certifications',certifications),notes=coalesce(command->>'notes',notes),version=version+1,updated_at=now() where id=person returning version into source_version;
  end if;
  if kind='import_person' then
   insert into public.hr_person_external_ids(external_source,external_id,person_id) values(command->>'external_source',command->>'external_id',person) on conflict do nothing;
   if command ? 'employment' and jsonb_typeof(command->'employment')='object' then
    if not private.is_admin() then raise exception 'Only administrators can import historical employment.'; end if;
    startday:=(command#>>'{employment,start_date}')::date; endday:=nullif(command#>>'{employment,end_date}','')::date;
     if startday is null then raise exception 'Historical employment requires its actual start date.'; end if;
     select id into emp from public.employees where person_id=person and start_date=startday;
     if emp is null then
      if exists(select 1 from public.employees where person_id=person and coalesce(end_date,'infinity'::date)>=startday and start_date<=coalesce(endday,'infinity'::date)) then raise exception 'Historical employment overlaps an existing employment period.'; end if;
     insert into public.employees(person_id,role,start_date,end_date,status,onboarding_completed_at,probation_status)
     values(person,coalesce(command#>>'{employment,role}',''),startday,endday,case when endday is not null then 'ended' when startday>current_date then 'preboarding' else 'active' end,case when startday<=current_date then now() else null end,case when endday is not null then 'ended' when startday>current_date then 'pending' else 'confirmed' end) returning id into emp;
     if startday>current_date and endday is null then insert into public.onboarding_items(employee_id,phase,title,assignee,due_date) values(emp,'preboarding','Verify imported employment documents and arrange access',actor_email,startday-1),(emp,'onboarding','Welcome and confirm first project plan',actor_email,startday); end if;
    end if;
   end if;
  end if;
  result:=result||jsonb_build_object('created',created,'version',source_version);
 when 'update_person' then
  perform private.hr_version(p.version,command->'expected_version');
  update public.hr_people set full_name=command->>'full_name',email=coalesce(command->>'email',email),phone=coalesce(command->>'phone',phone),headline=coalesce(command->>'headline',headline),location=coalesce(command->>'location',location),skills=coalesce(command->>'skills',skills),languages=coalesce(command->>'languages',languages),degrees=coalesce(command->>'degrees',degrees),certifications=coalesce(command->>'certifications',certifications),notes=coalesce(command->>'notes',notes),source=coalesce(command->>'source',source),owner_email=coalesce(command->>'owner_email',owner_email),contact_allowed=coalesce((command->>'contact_allowed')::boolean,contact_allowed),version=version+1,updated_at=now() where id=person returning version into source_version;
  update public.hr_ai_suggestions set status='stale' where person_id=person and status='draft';
  result:=result||jsonb_build_object('version',source_version);
 when 'link_account' then
  if person is null then raise exception 'Person required.'; end if;
  insert into public.hr_person_accounts(profile_id,person_id,linked_by) values((command->>'profile_id')::uuid,person,actor);
 when 'create_application' then
  if person is null then raise exception 'Person required.'; end if;
  select * into opp from public.opportunities where id=(command->>'opportunity_id')::uuid for update;
  if not found or opp.status not in ('approved','published') then raise exception 'Select an approved or published requisition.'; end if;
  insert into public.hr_applications(person_id,opportunity_id,source,referrer) values(person,opp.id,coalesce(command->>'source',p.source),coalesce(command->>'referrer','')) returning id,version into app,source_version;
  nxt:='application';result:=result||jsonb_build_object('version',source_version);
 when 'move_application' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' then raise exception 'Only active applications can move.'; end if;
  reqs:=public.hr_application_requirements(app,command->>'to_stage');
  if exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Complete the required evidence before moving: %', (select string_agg(j->>'label',', ') from jsonb_array_elements(reqs) j where not (j->>'done')::boolean); end if;
  prev:=a.stage;nxt:=command->>'to_stage';
  if prev=nxt then raise exception 'Application is already in this stage.'; end if;
  update public.hr_applications set stage=nxt,stage_entered_at=now(),version=version+1,updated_at=now() where id=app returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'dispose_application' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' or command->>'status' not in ('rejected','withdrawn') or length(trim(coalesce(command->>'reason','')))=0 then raise exception 'An active application and disposition reason are required.'; end if;
  prev:=a.status;nxt:=command->>'status';
  update public.hr_applications set status=nxt,reason=command->>'reason',version=version+1,updated_at=now() where id=app returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'update_screening' then
  perform private.hr_version(a.version,command->'expected_version');
  if a.status<>'active' then raise exception 'Application is no longer active.'; end if;
  update public.hr_applications set screening_summary=command->>'screening_summary',screening_recommendation=command->>'screening_recommendation',version=version+1,updated_at=now() where id=app returning version into source_version;
  update public.hr_ai_suggestions set status='stale' where application_id=app and status='draft';
  result:=result||jsonb_build_object('version',source_version);
 when 'add_note' then
  if person is null or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'A person and note are required.'; end if;
 when 'schedule_interview' then
  if app is null or a.status<>'active' then raise exception 'Select an active application.'; end if;
  insert into public.interviews(application_id,kind,scheduled_at,panel,location) values(app,command->>'interview_kind',(command->>'scheduled_at')::timestamptz,command->>'panel',coalesce(command->>'location','')) returning id into iid;
  result:=result||jsonb_build_object('interview_id',iid);
 when 'complete_interview','cancel_interview' then
  select * into i from public.interviews where id=(command->>'interview_id')::uuid for update;
  if not found then raise exception 'Interview not found.'; end if;
  perform private.hr_version(i.version,command->'expected_version');
  if i.status<>'scheduled' then raise exception 'Only scheduled interviews can be completed or cancelled.'; end if;
  if kind='complete_interview' then
   if jsonb_typeof(command->'scorecard')<>'array' or jsonb_array_length(command->'scorecard')=0 or length(trim(coalesce(command->>'notes','')))=0 then raise exception 'Interview notes and a completed scorecard are required.'; end if;
   if exists(select 1 from jsonb_array_elements(command->'scorecard') j where jsonb_typeof(j)<>'object' or jsonb_typeof(j->'rating') is distinct from 'number' or length(trim(coalesce(j->>'competency','')))=0 or (j->>'rating')::numeric not between 1 and 5 or length(trim(coalesce(j->>'evidence','')))=0) then raise exception 'Each scorecard entry needs a rating from 1 to 5 and evidence.'; end if;
   update public.interviews set status='completed',scorecard=command->'scorecard',notes=command->>'notes',version=version+1 where id=i.id;
  else
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Cancellation reason required.'; end if;
   update public.interviews set status='cancelled',version=version+1 where id=i.id;
  end if;
  result:=result||jsonb_build_object('interview_id',i.id,'version',i.version+1);
 when 'create_offer' then
  if app is null or a.status<>'active' then raise exception 'Select an active application.'; end if;
  reqs:=public.hr_application_requirements(app,'decision');
  if a.stage not in ('decision','offer','contract') or exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Record a recruitment decision and complete interview evidence before drafting an offer.'; end if;
  insert into public.offers(application_id,title,contract_type,salary_monthly,cjm,target_tjm,valid_until) values(app,command->>'title',command->>'contract_type',(command->>'salary_monthly')::numeric,(command->>'cjm')::numeric,(command->>'target_tjm')::numeric,nullif(command->>'valid_until','')::date) returning id into oid;
  result:=result||jsonb_build_object('offer_id',oid,'version',1);
 when 'approve_offer','share_offer','respond_offer','cancel_offer' then
  select * into o from public.offers where id=(command->>'offer_id')::uuid for update;
  if not found then raise exception 'Offer not found.'; end if;
  perform private.hr_version(o.version,command->'expected_version'); prev:=o.status;
  if a.status<>'active' then raise exception 'Application is no longer active.'; end if;
  if kind='cancel_offer' then
   if o.status not in ('draft','pending_approval','pending_direction','approved','shared','accepted') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open offer and cancellation rationale are required.'; end if;
   nxt:='cancelled';update public.offers set status=nxt,version=version+1 where id=o.id;
  elsif kind='approve_offer' then
   if length(trim(coalesce(command->>'note','')))=0 then raise exception 'Approval note required.'; end if;
   if o.status='pending_direction' then
    if not private.is_admin() then raise exception 'Administrator direction approval required.'; end if;
    authority:='direction';nxt:='approved';
   elsif o.status='pending_approval' then
    authority:='hr';nxt:=case when o.margin_pct between 25 and 40 then 'approved' else 'pending_direction' end;
   else raise exception 'Offer is not awaiting approval.'; end if;
   insert into public.offer_approvals(offer_id,actor_id,authority,note) values(o.id,actor,authority,command->>'note');
   update public.offers set status=nxt,approver_note=command->>'note',decided_by=actor_email,version=version+1 where id=o.id;
  elsif kind='share_offer' then
   if o.status<>'approved' then raise exception 'Only approved offers can be shared.'; end if;
   if not exists(select 1 from public.hr_person_accounts where person_id=person) then raise exception 'Link a portal account before sharing this offer.'; end if;
   if o.valid_until is not null and o.valid_until<current_date then raise exception 'Offer has expired.'; end if;
   nxt:='shared';update public.offers set status=nxt,shared_at=now(),version=version+1 where id=o.id;
  else
   if o.status<>'shared' or command->>'response' not in ('accepted','declined') then raise exception 'Only shared offers can receive an acceptance or decline.'; end if;
   if o.valid_until is not null and o.valid_until<current_date then raise exception 'Offer has expired.'; end if;
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Response evidence is required.'; end if;
   nxt:=command->>'response';update public.offers set status=nxt,response_at=now(),version=version+1 where id=o.id;
  end if;
  result:=result||jsonb_build_object('offer_id',o.id,'version',o.version+1);
 when 'engage_person' then
  if person is null then raise exception 'Person required.'; end if;
  if length(trim(coalesce(command->>'role','')))=0 then raise exception 'Engagement role is required.'; end if;
  if command->>'contract_type' not in ('CDI','CDD','Freelance','Internship','Apprenticeship') then raise exception 'Select a contract type for the engagement.'; end if;
  if not private.hr_operator() then raise exception 'HR access required.'; end if;
  startday:=(command->>'start_date')::date;
  if exists(select 1 from public.employees where person_id=person and status<>'ended') then raise exception 'This person already has an open employment period.'; end if;
  if exists(select 1 from public.employees where person_id=person and end_date>=startday) then raise exception 'A re-engagement must start after the previous employment period ended.'; end if;
  insert into public.employees(person_id,role,contract_type,manager_email,start_date,status,onboarding_completed_at,probation_status)
  values(person,command->>'role',command->>'contract_type',coalesce(command->>'manager_email',''),startday,case when startday>current_date then 'preboarding' else 'active' end,case when startday<=current_date then now() else null end,case when startday>current_date then 'pending' else 'confirmed' end) returning id into emp;
  if startday>current_date then insert into public.onboarding_items(employee_id,phase,title,assignee,due_date) values(emp,'preboarding','Verify engagement documents and arrange access',actor_email,startday-1),(emp,'onboarding','Welcome and confirm first project plan',coalesce(command->>'manager_email',actor_email),startday); end if;
  prev:='talent_pool';nxt:='engaged';
  result:=result||jsonb_build_object('employee_id',emp,'version',1);
 when 'hire' then
  perform private.hr_version(a.version,command->'expected_version');
  reqs:=public.hr_application_requirements(app,'hire');
  if exists(select 1 from jsonb_array_elements(reqs) j where not (j->>'done')::boolean) then raise exception 'Hire prerequisites: %', (select string_agg(j->>'label',', ') from jsonb_array_elements(reqs) j where not (j->>'done')::boolean); end if;
  if length(trim(coalesce(command->>'role','')))=0 then raise exception 'Employment role is required.'; end if;
  if a.status<>'active' or a.stage<>'contract' then raise exception 'Move the active application to Contract before hiring.'; end if;
  select * into o from public.offers where application_id=app and status='accepted' order by created_at desc limit 1;
  if not found then raise exception 'An accepted offer is required.'; end if;
  if not exists(select 1 from public.contracts c join public.contract_signatures candidate_sig on candidate_sig.contract_id=c.id and candidate_sig.document_sha256=c.document_sha256 join public.contract_countersignatures cs on cs.contract_id=c.id and cs.document_sha256=c.document_sha256 where c.application_id=app and c.person_id=person and c.offer_id=o.id) then raise exception 'A linked contract signed by the candidate and employer is required.'; end if;
  if exists(select 1 from public.employees where person_id=person and status<>'ended') then raise exception 'This person already has an open employment period.'; end if;
  startday:=(command->>'start_date')::date;
  if exists(select 1 from public.employees where person_id=person and end_date>=startday) then raise exception 'A rehire must start after the previous employment period ended.'; end if;
  insert into public.employees(person_id,application_id,offer_id,role,contract_type,manager_email,parrain,start_date,probation_end)
  values(person,app,o.id,command->>'role',o.contract_type,coalesce(command->>'manager_email',''),coalesce(command->>'parrain',''),startday,nullif(command->>'probation_end','')::date) returning id into emp;
  if o.salary_monthly>0 then insert into public.employee_salaries(employee_id,salary_monthly,start_date,rationale) values(emp,o.salary_monthly,startday,'Initial salary from the accepted offer'); end if;
  insert into public.onboarding_items(employee_id,phase,title,assignee,due_date) values
  (emp,'preboarding','Verify employment documents',actor_email,startday-3),
  (emp,'preboarding','Prepare equipment and access',actor_email,startday-1),
  (emp,'onboarding','Welcome and team introduction',coalesce(command->>'manager_email',actor_email),startday),
  (emp,'onboarding','Confirm role and first project plan',coalesce(command->>'manager_email',actor_email),startday+7);
  if nullif(command->>'probation_end','') is not null then insert into public.reviews(employee_id,kind,due_date) values(emp,'probation',(command->>'probation_end')::date-7); end if;
  prev:=a.status;nxt:='hired';update public.hr_applications set status='hired',version=version+1,updated_at=now() where id=app;
  update public.contracts set employee_id=emp where application_id=app;
  result:=result||jsonb_build_object('version',a.version+1);
 when 'start_onboarding','complete_onboarding' then
  perform private.hr_version(e.version,command->'expected_version');
  if kind='start_onboarding' then
   if e.status<>'preboarding' then raise exception 'Only preboarding employment can start onboarding.'; end if;
   if e.start_date>current_date then raise exception 'Onboarding starts on or after the employment start date.'; end if;
   if exists(select 1 from public.onboarding_items where employee_id=emp and phase='preboarding' and required and completed_at is null) then raise exception 'Complete required preboarding tasks first.'; end if;
   prev:=e.status;nxt:='active';update public.employees set status='active',version=version+1,updated_at=now() where id=emp;
  else
   if e.status<>'active' or e.onboarding_completed_at is not null then raise exception 'Only active unfinished onboarding can be completed.'; end if;
   if exists(select 1 from public.onboarding_items where employee_id=emp and phase in ('preboarding','onboarding') and required and completed_at is null) then raise exception 'Complete required onboarding tasks first.'; end if;
   update public.employees set onboarding_completed_at=now(),version=version+1,updated_at=now() where id=emp;nxt:='onboarding_completed';
  end if;
  result:=result||jsonb_build_object('version',e.version+1);
 when 'update_employment' then
  perform private.hr_version(e.version,command->'expected_version');
  update public.employees set manager_email=coalesce(command->>'manager_email',manager_email),parrain=coalesce(command->>'parrain',parrain),version=version+1,updated_at=now() where id=emp returning version into source_version;
  result:=result||jsonb_build_object('version',source_version);
 when 'save_salary' then
  if emp is null then raise exception 'Employment required.'; end if;
  if (command->>'salary_monthly')::numeric<0 then raise exception 'Salary must be zero or positive.'; end if;
  startday:=(command->>'start_date')::date; endday:=nullif(command->>'end_date','')::date;
  if endday is not null and endday<startday then raise exception 'Salary end date cannot precede its start date.'; end if;
  if startday<e.start_date or (e.end_date is not null and startday>e.end_date) or (e.end_date is not null and endday>e.end_date) then raise exception 'Salary dates must fit the employment period.'; end if;
  if e.status='ended' and endday is null then raise exception 'Ended employment only accepts salary entries closed with an end date.'; end if;
  if command ? 'salary_id' then
   select * into sal from public.employee_salaries where id=(command->>'salary_id')::uuid for update;
   if not found then raise exception 'Salary entry not found.'; end if;
   if sal.employee_id<>emp then raise exception 'Salary entry does not belong to this employment.'; end if;
   perform private.hr_version(sal.version,command->'expected_version');
   if length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'A rationale is required to change a recorded salary.'; end if;
   prev:=sal.salary_monthly::text;
   update public.employee_salaries set salary_monthly=(command->>'salary_monthly')::numeric,start_date=startday,end_date=endday,rationale=command->>'rationale',version=version+1,updated_at=now() where id=sal.id returning id,version into item,source_version;
  else
   if endday is null and exists(select 1 from public.employee_salaries where employee_id=emp and end_date is null and start_date>=startday) then raise exception 'An open salary entry already starts on or after this date.'; end if;
   update public.employee_salaries set end_date=startday-1,version=version+1,updated_at=now() where employee_id=emp and end_date is null and start_date<startday returning salary_monthly::text into prev;
   if exists(select 1 from public.employee_salaries where employee_id=emp and start_date<=coalesce(endday,'infinity'::date) and coalesce(end_date,'infinity'::date)>=startday) then raise exception 'Salary intervals cannot overlap.'; end if;
   insert into public.employee_salaries(employee_id,salary_monthly,start_date,end_date,rationale) values(emp,(command->>'salary_monthly')::numeric,startday,endday,coalesce(command->>'rationale','')) returning id,version into item,source_version;
  end if;
  nxt:=command->>'salary_monthly';
  result:=result||jsonb_build_object('salary_id',item,'version',source_version);
 when 'cancel_hire' then
  perform private.hr_version(e.version,command->'expected_version');
  if e.status<>'preboarding' or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'Only preboarding employment can be cancelled, with a renunciation rationale.'; end if;
  if exists(select 1 from public.offboarding_records where employee_id=emp and status='open') then raise exception 'An open exit already exists for this employment.'; end if;
  update public.employee_project_assignments set status='cancelled',version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');
  delete from public.employee_salaries where employee_id=emp;
  if e.application_id is not null then
   update public.offers set status='cancelled',version=version+1 where application_id=e.application_id and status in ('pending_approval','pending_direction','approved','shared','accepted');
   update public.hr_applications set status='withdrawn',reason=command->>'rationale',version=version+1,updated_at=now() where id=e.application_id and status='hired';
  end if;
  prev:=e.status;nxt:='ended';
  update public.employees set status='ended',end_date=start_date,probation_status=case when probation_status='pending' then 'ended' else probation_status end,version=version+1,updated_at=now() where id=emp;
  result:=result||jsonb_build_object('version',e.version+1);
 when 'save_task' then
  if emp is null or e.status='ended' then raise exception 'Select an open employment period.'; end if;
  if nullif(command->>'dependency_id','') is not null and not exists(select 1 from public.onboarding_items where id=(command->>'dependency_id')::uuid and employee_id=emp) then raise exception 'Task dependency must belong to the same employment.'; end if;
  if command ? 'task_id' then
   select * into t from public.onboarding_items where id=(command->>'task_id')::uuid for update;
   perform private.hr_version(t.version,command->'expected_version');
   if t.completed_at is not null then raise exception 'Completed tasks retain their evidence.'; end if;
   if nullif(command->>'dependency_id','') is not null and exists(with recursive deps as(select id,dependency_id from public.onboarding_items where id=(command->>'dependency_id')::uuid union select dependency_record.id,dependency_record.dependency_id from public.onboarding_items dependency_record join deps d on dependency_record.id=d.dependency_id) select 1 from deps where id=t.id) then raise exception 'Task dependencies cannot form a cycle.'; end if;
   update public.onboarding_items set phase=command->>'phase',title=command->>'title',assignee=command->>'assignee',due_date=nullif(command->>'due_date','')::date,required=coalesce((command->>'required')::boolean,true),dependency_id=nullif(command->>'dependency_id','')::uuid,evidence=coalesce(command->>'evidence',''),version=version+1 where id=t.id returning id,version into item,source_version;
  else
   insert into public.onboarding_items(employee_id,phase,title,assignee,due_date,required,dependency_id,evidence) values(emp,command->>'phase',command->>'title',command->>'assignee',nullif(command->>'due_date','')::date,coalesce((command->>'required')::boolean,true),nullif(command->>'dependency_id','')::uuid,coalesce(command->>'evidence','')) returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('task_id',item,'version',source_version);
 when 'complete_task' then
  select * into t from public.onboarding_items where id=(command->>'task_id')::uuid for update;
  if not found then raise exception 'Task not found.'; end if;
  perform private.hr_version(t.version,command->'expected_version');
  if e.status='ended' or t.completed_at is not null then raise exception 'Task cannot be completed in its current state.'; end if;
  if not private.hr_operator() and lower(t.assignee) not in (lower(actor_email),'employee','candidate') then raise exception 'This task is assigned to someone else.'; end if;
  if t.dependency_id is not null and not exists(select 1 from public.onboarding_items where id=t.dependency_id and completed_at is not null) then raise exception 'Complete the dependent task first.'; end if;
  if length(trim(coalesce(command->>'evidence','')))=0 then raise exception 'Task completion evidence required.'; end if;
  update public.onboarding_items set evidence=command->>'evidence',completed_at=now(),completed_by=actor,version=version+1 where id=t.id;
  result:=result||jsonb_build_object('task_id',t.id,'version',t.version+1);
 when 'schedule_review' then
  if emp is null or e.status='ended' then raise exception 'Select an open employment period.'; end if;
  insert into public.reviews(employee_id,kind,due_date) values(emp,command->>'review_kind',(command->>'due_date')::date) returning id into item;
  result:=result||jsonb_build_object('review_id',item,'version',1);
 when 'record_review' then
  select * into r from public.reviews where id=(command->>'review_id')::uuid for update;
  if not found then raise exception 'Review not found.'; end if;
  perform private.hr_version(r.version,command->'expected_version');
  if r.status<>'scheduled' or e.status='ended' or length(trim(coalesce(command->>'rationale','')))=0 or length(trim(coalesce(command->>'outcome','')))=0 then raise exception 'A scheduled review, outcome and rationale are required.'; end if;
  if r.kind='probation' and command->>'outcome' not in ('confirmed','extended','ended') then raise exception 'Probation outcome must be confirmed, extended or ended.'; end if;
  if r.kind='probation' and command->>'outcome'='extended' and ((command->>'probation_end')::date is null or (command->>'probation_end')::date<=coalesce(e.probation_end,e.start_date)) then raise exception 'A later probation end date is required.'; end if;
  update public.reviews set status='held',outcome=command->>'outcome',rationale=command->>'rationale',held_at=now(),version=version+1 where id=r.id;
  if r.kind='probation' then update public.employees set probation_status=command->>'outcome',probation_end=coalesce(nullif(command->>'probation_end','')::date,probation_end),version=version+1,updated_at=now() where id=emp; end if;
  result:=result||jsonb_build_object('review_id',r.id,'version',r.version+1);
 when 'open_exit' then
  perform private.hr_version(e.version,command->'expected_version');
  if e.status not in ('preboarding','active') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open employment period and departure reason are required.'; end if;
  endday:=(command->>'exit_date')::date;
  if endday<e.start_date then raise exception 'Exit cannot precede employment start.'; end if;
  insert into public.offboarding_records(employee_id,kind,exit_date,notice_end) values(emp,command->>'exit_kind',endday,nullif(command->>'notice_end','')::date) returning id into xid;
  insert into public.offboarding_items(offboarding_id,title) values(xid,'Project handover recorded'),(xid,'Return equipment and close access'),(xid,'Deliver legal exit documents');
  prev:=e.status;nxt:='offboarding';update public.employees set status=nxt,planned_exit_date=endday,version=version+1,updated_at=now() where id=emp;
  result:=result||jsonb_build_object('exit_id',xid,'version',1);
 when 'save_exit','complete_exit' then
  select * into x from public.offboarding_records where id=(command->>'exit_id')::uuid for update;
  if not found then raise exception 'Exit not found.'; end if;
  perform private.hr_version(x.version,command->'expected_version');
  if x.status<>'open' then raise exception 'Exit is already completed.'; end if;
  if kind='save_exit' then
   update public.offboarding_records set handover_plan=command->>'handover_plan',successor=command->>'successor',exit_interview=command->>'exit_interview',rehire_eligible=(command->>'rehire_eligible')::boolean,rehire_rationale=command->>'rehire_rationale',version=version+1 where id=x.id;
  else
   if x.exit_date>current_date then raise exception 'Exit can be completed on or after its departure date.'; end if;
   if length(trim(x.handover_plan))=0 or x.rehire_eligible is null or length(trim(x.rehire_rationale))=0 then raise exception 'Record handover and rehire decision before completing the exit.'; end if;
   if exists(select 1 from public.offboarding_items where offboarding_id=x.id and required and completed_at is null) then raise exception 'Complete required exit tasks first.'; end if;
   update public.offboarding_records set status='completed',completed_at=now(),version=version+1 where id=x.id;
   update public.employee_project_assignments set status=case when start_date>x.exit_date then 'cancelled' else 'completed' end,end_date=case when start_date>x.exit_date then end_date else least(coalesce(end_date,x.exit_date),x.exit_date) end,version=version+1,updated_at=now() where employee_id=emp and status in ('proposed','reserved','confirmed','active');
   delete from public.employee_salaries where employee_id=emp and start_date>x.exit_date;
   update public.employee_salaries set end_date=least(coalesce(end_date,x.exit_date),x.exit_date),version=version+1,updated_at=now() where employee_id=emp and (end_date is null or end_date>x.exit_date);
   update public.employees set status='ended',end_date=x.exit_date,probation_status=case when probation_status='pending' then 'ended' else probation_status end,version=version+1,updated_at=now() where id=emp;
   prev:=e.status;nxt:='ended';
  end if;
  result:=result||jsonb_build_object('exit_id',x.id,'version',x.version+1);
 when 'save_exit_item','complete_exit_item' then
  select * into x from public.offboarding_records where employee_id=emp and status='open' for update;
  if not found then raise exception 'Open exit not found.'; end if;
  if command ? 'item_id' then
   select * into xi from public.offboarding_items where id=(command->>'item_id')::uuid for update;
   if not found then raise exception 'Exit task not found.'; end if;
   perform private.hr_version(xi.version,command->'expected_version');
   if xi.completed_at is not null then raise exception 'Completed exit tasks cannot change.'; end if;
   if kind='complete_exit_item' then
    update public.offboarding_items set completed_at=now(),version=version+1 where id=xi.id;
   else
    update public.offboarding_items set title=command->>'title',required=coalesce((command->>'required')::boolean,true),version=version+1 where id=xi.id;
   end if;item:=xi.id;source_version:=xi.version+1;
  else
   insert into public.offboarding_items(offboarding_id,title,required) values(x.id,command->>'title',coalesce((command->>'required')::boolean,true)) returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('item_id',item,'version',source_version);
 when 'assign_project','update_assignment' then
  if kind='update_assignment' then
   select * into ass from public.employee_project_assignments where id=(command->>'assignment_id')::uuid for update;
   if not found then raise exception 'Assignment not found.'; end if;
   perform private.hr_version(ass.version,command->'expected_version');
   if ass.status in ('completed','cancelled') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open assignment and change rationale are required.'; end if;
   if ass.status in ('reserved','confirmed','active') and ass.start_date<=current_date and command->>'status'='proposed' then raise exception 'A started commitment cannot return to proposed status.'; end if;
   oid:=ass.project_id;
  else oid:=(command->>'project_id')::uuid; end if;
  if emp is null or e.status not in ('preboarding','active') then raise exception 'Projects require an open employment period outside offboarding.'; end if;
  startday:=(command->>'start_date')::date;endday:=nullif(command->>'end_date','')::date;
  perform project_record.id from public.sales_projects project_record where project_record.id=oid for share;
  if not found then raise exception 'Project not found.'; end if;
  if exists(select 1 from public.sales_projects where id=oid and ((start_date is not null and startday<start_date) or (end_date is not null and (endday is null or endday>end_date)))) then raise exception 'Assignment dates must fit the project window.'; end if;
  if startday<e.start_date or (e.planned_exit_date is not null and (endday is null or endday>e.planned_exit_date)) then raise exception 'Assignment dates must fit employment dates.'; end if;
  if command->>'status'='active' and startday>current_date then raise exception 'Active assignment cannot start in the future.'; end if;
  if command->>'status' not in ('proposed','reserved','confirmed','active') then raise exception 'Invalid assignment status.'; end if;
  if nullif(command->>'pricing_line','') is not null and not exists(select 1 from public.sales_projects pricing_source where pricing_source.id=oid and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(pricing_source.tjm_profiles)='array' then pricing_source.tjm_profiles else '[]'::jsonb end) pricing_candidate where pricing_candidate->>'name'=command->>'pricing_line')) then raise exception 'Unknown pricing line for this project.'; end if;
  if command->>'status'<>'proposed' and exists(
   with boundaries as (select startday as day union select start_date from public.employee_project_assignments where employee_id=emp and id is distinct from ass.id and status in ('reserved','confirmed','active','completed') and start_date>=startday and start_date<=coalesce(endday,'infinity'::date))
   select 1 from boundaries b where (command->>'allocation_pct')::integer+coalesce((select sum(allocation_pct) from public.employee_project_assignments capacity_record where capacity_record.employee_id=emp and capacity_record.id is distinct from ass.id and capacity_record.status in ('reserved','confirmed','active','completed') and capacity_record.start_date<=b.day and coalesce(capacity_record.end_date,'infinity'::date)>=b.day),0)>100
  ) then raise exception 'Assignment exceeds 100%% capacity during the requested dates.'; end if;
  if kind='update_assignment' then
   update public.employee_project_assignments set position=command->>'position',pricing_line=coalesce(nullif(command->>'pricing_line',''),ass.pricing_line),allocation_pct=(command->>'allocation_pct')::integer,start_date=startday,end_date=endday,status=command->>'status',version=version+1,updated_at=now() where id=ass.id returning id,version into item,source_version;
  else
   insert into public.employee_project_assignments(employee_id,project_id,position,pricing_line,allocation_pct,start_date,end_date,status) values(emp,oid,command->>'position',coalesce(nullif(command->>'pricing_line',''),''),(command->>'allocation_pct')::integer,startday,endday,command->>'status') returning id,version into item,source_version;
  end if;
  result:=result||jsonb_build_object('assignment_id',item,'version',source_version);
 when 'end_assignment' then
  select * into ass from public.employee_project_assignments where id=(command->>'assignment_id')::uuid for update;
  if not found then raise exception 'Assignment not found.'; end if;
  perform private.hr_version(ass.version,command->'expected_version');
  if ass.status in ('completed','cancelled') or length(trim(coalesce(command->>'rationale','')))=0 then raise exception 'An open assignment and closing reason are required.'; end if;
  if coalesce((command->>'cancel')::boolean,false) and ass.status<>'proposed' and ass.start_date<=current_date then raise exception 'Started commitments must be completed with their actual end date, rather than cancelled.'; end if;
  endday:=(command->>'end_date')::date;
  if not coalesce((command->>'cancel')::boolean,false) and endday>current_date then raise exception 'Complete assignments on or after their actual end date. Cancel to release a future reservation.'; end if;
  if not coalesce((command->>'cancel')::boolean,false) and (endday<ass.start_date or (ass.end_date is not null and endday>ass.end_date)) then raise exception 'Completion must fall within the assignment window.'; end if;
  update public.employee_project_assignments set status=case when coalesce((command->>'cancel')::boolean,false) then 'cancelled' else 'completed' end,end_date=case when coalesce((command->>'cancel')::boolean,false) then end_date else endday end,version=version+1,updated_at=now() where id=ass.id;
  result:=result||jsonb_build_object('assignment_id',ass.id,'version',ass.version+1);
 when 'create_requisition' then
  if command->>'hiring_mode'='sur_profil' and length(trim(coalesce(command->>'justification','')))=0 then raise exception 'Profile hiring justification is required.'; end if;
  insert into public.opportunities(title,hiring_mode,job_id,project_id,client_ids,client_need,skill_family,owner_email,target_tjm,justification,status,decided_by,decided_at)
  values(command->>'title',command->>'hiring_mode',nullif(command->>'job_id','')::uuid,nullif(command->>'project_id','')::uuid,coalesce(client_links,'{}'),coalesce(command->>'client_need',''),coalesce(command->>'skill_family',''),coalesce(command->>'owner_email',actor_email),nullif(command->>'target_tjm','')::numeric,coalesce(command->>'justification',''),'approved',actor_email,now()) returning id into oid;
  result:=result||jsonb_build_object('opportunity_id',oid,'version',1);
 when 'update_requisition','publish_requisition' then
  select * into opp from public.opportunities where id=(command->>'opportunity_id')::uuid for update;
  if not found then raise exception 'Requisition not found.'; end if;
  perform private.hr_version(opp.version,command->'expected_version');
  if kind='update_requisition' then
   if opp.status not in ('draft','pending_approval','approved') then raise exception 'Published or closed requisitions cannot be edited. Create a new one for changed requirements.'; end if;
   update public.opportunities set title=command->>'title',hiring_mode=command->>'hiring_mode',job_id=nullif(command->>'job_id','')::uuid,project_id=nullif(command->>'project_id','')::uuid,client_ids=coalesce(client_links,opp.client_ids),client_need=coalesce(command->>'client_need',''),skill_family=coalesce(command->>'skill_family',''),owner_email=coalesce(command->>'owner_email',actor_email),target_tjm=nullif(command->>'target_tjm','')::numeric,justification=coalesce(command->>'justification',''),version=version+1,updated_at=now() where id=opp.id;
  else
   if opp.status<>'approved' then raise exception 'Only approved requisitions can be published.'; end if;
   update public.jobs set published=true,updated_at=now() where id=(command->>'job_id')::uuid;
   if not found then raise exception 'Job post not found.'; end if;
   update public.opportunities set status='published',job_id=(command->>'job_id')::uuid,version=version+1,updated_at=now() where id=opp.id;
  end if;
  result:=result||jsonb_build_object('opportunity_id',opp.id,'version',opp.version+1);
 when 'countersign_contract' then
  select c.person_id,c.application_id,c.employee_id into person,app,emp from public.contracts c where c.id=(command->>'contract_id')::uuid for update;
  if person is null then raise exception 'Link the contract to a person and application first.'; end if;
  insert into public.contract_countersignatures(contract_id,actor_id,signer_name,document_sha256) select id,actor,command->>'signer_name',document_sha256 from public.contracts where id=(command->>'contract_id')::uuid;
 when 'save_suggestion' then
  if person is null and app is null and emp is null and nullif(command->>'opportunity_id','') is null then raise exception 'A suggestion target is required.'; end if;
  if app is not null and nullif(command->>'person_id','')::uuid is distinct from person then raise exception 'Suggestion application does not belong to selected person.'; end if;
  if emp is not null and nullif(command->>'person_id','')::uuid is distinct from person then raise exception 'Suggestion employment does not belong to selected person.'; end if;
  if person is not null and p.version<>(command->>'input_version')::integer then raise exception 'Suggestion sources changed. Generate it again.'; end if;
  if jsonb_typeof(command->'sources')<>'array' or jsonb_array_length(command->'sources')=0 then raise exception 'Evidence sources are required.'; end if;
  for evidence_source in select value from jsonb_array_elements(command->'sources') order by value->>'type',value->>'id' loop
   source_version:=null;
   case evidence_source->>'type'
   when 'person' then select version into source_version from public.hr_people where id=(evidence_source->>'id')::uuid and id=person;
   when 'application' then select version into source_version from public.hr_applications where id=(evidence_source->>'id')::uuid and person_id=person;
   when 'employee' then select version into source_version from public.employees where id=(evidence_source->>'id')::uuid and person_id=person;
   when 'task' then select source_record.version into source_version from public.onboarding_items source_record join public.employees source_employment on source_employment.id=source_record.employee_id where source_record.id=(evidence_source->>'id')::uuid and source_employment.person_id=person;
   when 'assignment' then select source_record.version into source_version from public.employee_project_assignments source_record join public.employees source_employment on source_employment.id=source_record.employee_id where source_record.id=(evidence_source->>'id')::uuid and source_employment.person_id=person;
   when 'project' then select version into source_version from public.sales_projects where id=(evidence_source->>'id')::uuid for share;
   when 'opportunity' then select version into source_version from public.opportunities where id=(evidence_source->>'id')::uuid for share;
   else raise exception 'Unknown suggestion evidence type.'; end case;
   if source_version is null or source_version is distinct from (evidence_source->>'version')::integer then raise exception 'Suggestion source changed or is outside this person. Generate it again.'; end if;
  end loop;
  insert into public.hr_ai_suggestions(person_id,application_id,employee_id,opportunity_id,kind,payload,sources,input_version,model) values(person,app,emp,nullif(command->>'opportunity_id','')::uuid,command->>'suggestion_kind',command->'payload',command->'sources',(command->>'input_version')::integer,command->>'model') returning id into sid;
  result:=result||jsonb_build_object('suggestion_id',sid);
 when 'review_suggestion' then
  select * into s from public.hr_ai_suggestions where id=(command->>'suggestion_id')::uuid for update;
  if not found or s.status<>'draft' then raise exception 'Only draft suggestions can be reviewed; this suggestion may be stale.'; end if;
  person:=s.person_id;app:=s.application_id;emp:=s.employee_id;
  if command->>'status' not in ('accepted','dismissed') then raise exception 'Review must accept or dismiss.'; end if;
  if person is not null and not exists(select 1 from public.hr_people where id=person and version=s.input_version) then raise exception 'Suggestion is stale. Generate it again.'; end if;
  for evidence_source in select value from jsonb_array_elements(s.sources) order by value->>'type',value->>'id' loop
   source_version:=null;
   case evidence_source->>'type'
   when 'person' then select version into source_version from public.hr_people where id=(evidence_source->>'id')::uuid;
   when 'application' then select version into source_version from public.hr_applications where id=(evidence_source->>'id')::uuid;
   when 'employee' then select version into source_version from public.employees where id=(evidence_source->>'id')::uuid;
   when 'task' then select version into source_version from public.onboarding_items where id=(evidence_source->>'id')::uuid;
   when 'assignment' then select version into source_version from public.employee_project_assignments where id=(evidence_source->>'id')::uuid;
   when 'project' then select version into source_version from public.sales_projects where id=(evidence_source->>'id')::uuid for share;
   when 'opportunity' then select version into source_version from public.opportunities where id=(evidence_source->>'id')::uuid for share;
   else raise exception 'Unknown suggestion evidence.'; end case;
   if source_version is distinct from (evidence_source->>'version')::integer then raise exception 'Suggestion is stale. Generate it again.'; end if;
  end loop;
  update public.hr_ai_suggestions set status=command->>'status',reviewed_by=actor,reviewed_at=now() where id=s.id;
  result:=result||jsonb_build_object('suggestion_id',s.id);
 else raise exception 'Unknown HR command: %',kind;
 end case;
 if person is not null then
  insert into public.hr_events(person_id,application_id,employee_id,kind,previous_state,next_state,actor_id,actor_email,rationale,request_id)
  values(person,app,emp,kind,prev,nxt,actor,actor_email,coalesce(command->>'rationale',command->>'reason',command->>'note',''),request);
 end if;
 result:=result||jsonb_strip_nulls(jsonb_build_object('person_id',person,'application_id',app,'employee_id',emp));
 insert into public.hr_command_receipts(actor_id,request_id,command,result) values(actor,request,command,result);
 return result;
end;
$$;

notify pgrst, 'reload schema';

