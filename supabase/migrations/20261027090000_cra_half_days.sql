-- Half-day CRA entries: each row is a whole day ('full'), a morning ('am')
-- or an afternoon ('pm'). Existing rows default to 'full' and stay valid.
alter table public.cra_entries
 add column part text not null default 'full' check (part in ('full','am','pm'));
alter table public.cra_entries drop constraint cra_entries_pkey;
alter table public.cra_entries add primary key (employee_id, day, part);

create or replace function public.cra_month_snapshot(target_employee uuid, target_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.cra_access(target_employee) then raise exception 'You cannot access this employee CRA.'; end if;
 if target_month is null or extract(day from target_month)<>1 then raise exception 'Choose the first day of a month.'; end if;
 return jsonb_build_object(
  'version',coalesce((select version from public.cra_months where employee_id=target_employee and month=target_month),0),
  'updated_at',(select updated_at from public.cra_months where employee_id=target_employee and month=target_month),
  'updated_by',(select p.email from public.cra_months m join public.profiles p on p.id=m.updated_by where m.employee_id=target_employee and m.month=target_month),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('day',day,'part',part,'status',status,'project_id',project_id) order by day,part) from public.cra_entries where employee_id=target_employee and month=target_month),'[]')
 );
end;
$$;

create or replace function public.cra_save_month(target_employee uuid, target_month date, expected_version integer, entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employment public.employees; current_version integer; entry jsonb; entry_day date; entry_part text; entry_status text; entry_project uuid;
begin
 if not private.cra_access(target_employee) then raise exception 'You cannot edit this employee CRA.'; end if;
 if private.workspace_user_id() is null then raise exception 'Sign in to save your CRA.'; end if;
 if target_month is null or extract(day from target_month)<>1 then raise exception 'Choose the first day of a month.'; end if;
 if expected_version is null or expected_version<0 then raise exception 'A CRA version is required.'; end if;
 if entries is null or jsonb_typeof(entries)<>'array' then raise exception 'CRA entries must be an array.'; end if;
 if jsonb_array_length(entries)>62 then raise exception 'Only two entries per day are allowed.'; end if;
 select * into employment from public.employees where id=target_employee for share;
 if not found then raise exception 'Employee not found.'; end if;
 insert into public.cra_months(employee_id,month) values(target_employee,target_month) on conflict do nothing;
 select version into current_version from public.cra_months where employee_id=target_employee and month=target_month for update;
 if current_version<>expected_version then raise exception 'This CRA was changed by another person. Reload the month before saving.'; end if;
 -- At most one entry per (day,part); a day cannot mix a full-day entry with halves.
 if (select count(*)<>count(distinct (item->>'day',coalesce(item->>'part','full'))) from jsonb_array_elements(entries) item) then raise exception 'Only one entry per day and part is allowed.'; end if;
 if exists(select 1 from jsonb_array_elements(entries) item group by item->>'day' having count(*)>1 and bool_or(coalesce(item->>'part','full')='full')) then raise exception 'A day cannot mix a full day with a morning or afternoon.'; end if;
 for entry in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['day','status','project_id']) or exists(select 1 from jsonb_object_keys(entry) k where k not in ('day','part','status','project_id')) then raise exception 'Each entry needs a day, part, status and project reference.'; end if;
  entry_day:=(entry->>'day')::date; entry_part:=coalesce(entry->>'part','full'); entry_status:=entry->>'status'; entry_project:=(entry->>'project_id')::uuid;
  if entry_day is null or entry_day<target_month or entry_day>=(target_month+interval '1 month')::date then raise exception 'Every entry must belong to the selected month.'; end if;
  if entry_day<employment.start_date or (employment.end_date is not null and entry_day>employment.end_date) then raise exception 'Every entry must fall within the employment period.'; end if;
  if entry_part not in ('full','am','pm') then raise exception 'Choose a valid entry part.'; end if;
  if entry_status is null or entry_status not in ('rtt','unpaid_leave','paid_leave','internal','client_project') then raise exception 'Choose a valid CRA status.'; end if;
  if (entry_status='client_project')<>(entry_project is not null) then raise exception 'Only Client Project entries require a project.'; end if;
  if entry_status='client_project' then
   perform 1 from public.employee_project_assignments a where a.employee_id=target_employee and a.project_id=entry_project
    and a.status in ('confirmed','active','completed') and a.start_date<=entry_day and (a.end_date is null or a.end_date>=entry_day) for share;
   if not found then raise exception 'The client project must be assigned to this employee on the selected day.'; end if;
  end if;
 end loop;
 delete from public.cra_entries where employee_id=target_employee and month=target_month;
 insert into public.cra_entries(employee_id,month,day,part,status,project_id)
  select target_employee,target_month,(item->>'day')::date,coalesce(item->>'part','full'),item->>'status',(item->>'project_id')::uuid from jsonb_array_elements(entries) item;
 update public.cra_months set version=version+1,updated_by=private.workspace_user_id(),updated_at=now() where employee_id=target_employee and month=target_month;
 return public.cra_month_snapshot(target_employee,target_month);
end;
$$;
notify pgrst, 'reload schema';
