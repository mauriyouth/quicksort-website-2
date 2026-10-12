do $$
begin
 if (select count(*) from public.hr_people)<>3 or (select count(*) from public.employees)<>1 then
  raise exception 'Upgrade must preserve every person and only dated employment facts.';
 end if;
 if not exists(select 1 from public.employees where id='13000000-0000-4000-8000-000000000005' and person_id='13000000-0000-4000-8000-000000000002' and start_date='2020-01-15' and status='active' and probation_status='confirmed') then
  raise exception 'Dated employment IDs and facts changed.';
 end if;
 if not exists(select 1 from public.hr_people where id='13000000-0000-4000-8000-000000000003' and headline='Designer' and notes like '%actual employment start date is missing%') then
  raise exception 'Undated employee must retain identity, role and an actionable review note.';
 end if;
 if not exists(select 1 from public.hr_people where id='13000000-0000-4000-8000-000000000002' and notes like '%Original candidate notes%' and notes like '%Updated employee notes%') then
  raise exception 'Candidate and employee notes were not preserved.';
 end if;
 if (select count(*) from hr_legacy_20261014.employees)<>2 or (select count(*) from hr_legacy_20261014.pipeline_events)<>2 then
  raise exception 'Original employment and actor history must remain archived.';
 end if;
 if (select count(*) from public.hr_events where kind='legacy_pipeline_event' and actor_email='upgrade-admin@example.invalid' and rationale='Known actor decision')<>1 then
  raise exception 'Known audit actors must retain their real identity.';
 end if;
 if exists(select 1 from public.hr_events where actor_email='former-actor@example.invalid') then
  raise exception 'Unknown audit actors must not be invented.';
 end if;
 if has_schema_privilege('authenticated','hr_legacy_20261014','usage') or has_table_privilege('authenticated','hr_legacy_20261014.employees','select') then
  raise exception 'Legacy HR archive must not be exposed to application users.';
 end if;
 if (select count(*) from public.hr_person_accounts)<>0 then
  raise exception 'The upgrade must not invent portal account links.';
 end if;
 if not exists(select 1 from public.candidate_requests where id='13000000-0000-4000-8000-000000000009' and message='Keep this request') then
  raise exception 'Candidate requests were not preserved.';
 end if;
 if not exists(select 1 from public.sales_clients where id='13000000-0000-4000-8000-000000000007' and notes='Keep sales data') or not exists(select 1 from public.sales_projects where id='13000000-0000-4000-8000-000000000008' and fixed_price=1000) then
  raise exception 'Sales records changed during the HR upgrade.';
 end if;
end;
$$;
select set_config('request.jwt.claims','{"sub":"13000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
set role authenticated;
do $$
declare snapshot jsonb:=public.hr_workspace_snapshot();
begin
 if jsonb_array_length(snapshot->'people')<>3 or jsonb_array_length(snapshot->'employees')<>1 then
  raise exception 'The actual workspace RPC does not expose upgraded records.';
 end if;
end;
$$;
reset role;
