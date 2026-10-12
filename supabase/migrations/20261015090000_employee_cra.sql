create function private.cra_access(target_employee uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.hr_operator() or exists(
  select 1 from public.employees e join public.hr_person_accounts a on a.person_id=e.person_id
  where e.id=target_employee and a.profile_id=private.workspace_user_id()
 );
$$;
revoke all on function private.cra_access(uuid) from public;
grant execute on function private.cra_access(uuid) to authenticated;

create table public.cra_months (
 employee_id uuid not null references public.employees(id),
 month date not null check(extract(day from month)=1),
 version integer not null default 0 check(version>=0),
 updated_by uuid references public.profiles(id), updated_at timestamptz,
 primary key(employee_id,month)
);
create table public.cra_entries (
 employee_id uuid not null, month date not null, day date not null,
 status text not null check(status in ('rtt','unpaid_leave','paid_leave','internal','client_project')),
 project_id uuid references public.sales_projects(id),
 primary key(employee_id,day),
 foreign key(employee_id,month) references public.cra_months(employee_id,month),
 check(day>=month and day<(month+interval '1 month')::date),
 check((status='client_project')=(project_id is not null))
);
alter table public.cra_months enable row level security;
alter table public.cra_entries enable row level security;
revoke all on public.cra_months, public.cra_entries from anon,authenticated;
grant select on public.cra_months, public.cra_entries to authenticated;
create policy cra_months_read on public.cra_months for select to authenticated using(private.cra_access(employee_id));
create policy cra_entries_read on public.cra_entries for select to authenticated using(private.cra_access(employee_id));

create function public.cra_context() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'full_name',p.full_name,'role',e.role,'start_date',e.start_date,'end_date',e.end_date) order by p.full_name,e.start_date desc)
   from public.employees e join public.hr_people p on p.id=e.person_id where private.cra_access(e.id)),'[]'),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,'project_id',a.project_id,'start_date',a.start_date,'end_date',a.end_date,'status',a.status,'title',p.title,'client_name',c.name))
   from public.employee_project_assignments a join public.sales_projects p on p.id=a.project_id join public.sales_clients c on c.id=p.client_id where private.cra_access(a.employee_id)),'[]')
 );
$$;

create function public.cra_month_snapshot(target_employee uuid, target_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.cra_access(target_employee) then raise exception 'You cannot access this employee CRA.'; end if;
 if target_month is null or extract(day from target_month)<>1 then raise exception 'Choose the first day of a month.'; end if;
 return jsonb_build_object(
  'version',coalesce((select version from public.cra_months where employee_id=target_employee and month=target_month),0),
  'updated_at',(select updated_at from public.cra_months where employee_id=target_employee and month=target_month),
  'updated_by',(select p.email from public.cra_months m join public.profiles p on p.id=m.updated_by where m.employee_id=target_employee and m.month=target_month),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('day',day,'status',status,'project_id',project_id) order by day) from public.cra_entries where employee_id=target_employee and month=target_month),'[]')
 );
end;
$$;

create function public.cra_save_month(target_employee uuid, target_month date, expected_version integer, entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employment public.employees; current_version integer; entry jsonb; entry_day date; entry_status text; entry_project uuid;
begin
 if not private.cra_access(target_employee) then raise exception 'You cannot edit this employee CRA.'; end if;
 if private.workspace_user_id() is null then raise exception 'Sign in to save your CRA.'; end if;
 if target_month is null or extract(day from target_month)<>1 then raise exception 'Choose the first day of a month.'; end if;
 if expected_version is null or expected_version<0 then raise exception 'A CRA version is required.'; end if;
 if entries is null or jsonb_typeof(entries)<>'array' then raise exception 'CRA entries must be an array.'; end if;
 if jsonb_array_length(entries)>31 then raise exception 'Only one entry per day is allowed.'; end if;
 select * into employment from public.employees where id=target_employee for share;
 if not found then raise exception 'Employee not found.'; end if;
 insert into public.cra_months(employee_id,month) values(target_employee,target_month) on conflict do nothing;
 select version into current_version from public.cra_months where employee_id=target_employee and month=target_month for update;
 if current_version<>expected_version then raise exception 'This CRA was changed by another person. Reload the month before saving.'; end if;
 if (select count(*)<>count(distinct item->>'day') from jsonb_array_elements(entries) item) then raise exception 'Only one entry per day is allowed.'; end if;
 for entry in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['day','status','project_id']) or exists(select 1 from jsonb_object_keys(entry) k where k not in ('day','status','project_id')) then raise exception 'Each entry needs a day, status and project reference.'; end if;
  entry_day:=(entry->>'day')::date; entry_status:=entry->>'status'; entry_project:=(entry->>'project_id')::uuid;
  if entry_day is null or entry_day<target_month or entry_day>=(target_month+interval '1 month')::date then raise exception 'Every entry must belong to the selected month.'; end if;
  if entry_day<employment.start_date or (employment.end_date is not null and entry_day>employment.end_date) then raise exception 'Every entry must fall within the employment period.'; end if;
  if entry_status is null or entry_status not in ('rtt','unpaid_leave','paid_leave','internal','client_project') then raise exception 'Choose a valid CRA status.'; end if;
  if (entry_status='client_project')<>(entry_project is not null) then raise exception 'Only Client Project entries require a project.'; end if;
  if entry_status='client_project' then
   perform 1 from public.employee_project_assignments a where a.employee_id=target_employee and a.project_id=entry_project
    and a.status in ('confirmed','active','completed') and a.start_date<=entry_day and (a.end_date is null or a.end_date>=entry_day) for share;
   if not found then raise exception 'The client project must be assigned to this employee on the selected day.'; end if;
  end if;
 end loop;
 delete from public.cra_entries where employee_id=target_employee and month=target_month;
 insert into public.cra_entries(employee_id,month,day,status,project_id)
  select target_employee,target_month,(item->>'day')::date,item->>'status',(item->>'project_id')::uuid from jsonb_array_elements(entries) item;
 update public.cra_months set version=version+1,updated_by=private.workspace_user_id(),updated_at=now() where employee_id=target_employee and month=target_month;
 return public.cra_month_snapshot(target_employee,target_month);
end;
$$;
revoke all on function public.cra_context(),public.cra_month_snapshot(uuid,date),public.cra_save_month(uuid,date,integer,jsonb) from public,anon;
grant execute on function public.cra_context(),public.cra_month_snapshot(uuid,date),public.cra_save_month(uuid,date,integer,jsonb) to authenticated;
notify pgrst, 'reload schema';
