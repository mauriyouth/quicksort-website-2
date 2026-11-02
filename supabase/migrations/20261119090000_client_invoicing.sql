-- Client invoicing (Qonto): admin-only tables, plus a CRA lock once a month is invoiced.
create table public.invoicing_settings (
 id text primary key default 'default' check (id='default'),
 provider text not null default 'qonto',
 encrypted_credentials text,
 options jsonb not null default '{}',
 start_month date check (start_month is null or extract(day from start_month)=1),
 last_synced_at timestamptz,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);

create table public.invoicing_client_links (
 client_id uuid primary key references public.sales_clients(id) on delete cascade,
 provider text not null,
 provider_client_id text not null,
 provider_client_name text not null default '',
 linked_by uuid,
 linked_at timestamptz not null default now(),
 unique(provider, provider_client_id)
);

create table public.invoicing_product_links (
 project_id uuid references public.sales_projects(id) on delete cascade,
 pricing_line text not null,
 provider text not null,
 provider_product_id text not null,
 title text not null,
 description text not null default '',
 unit text not null default 'jour',
 vat_rate numeric not null default 0.2,
 primary key(project_id, pricing_line)
);

create table public.invoices (
 id uuid primary key default gen_random_uuid(),
 provider text not null,
 provider_invoice_id text,
 number text,
 status text not null check (status in ('draft','finalized','paid','canceled')),
 source text not null check (source in ('cra','imported')),
 project_id uuid references public.sales_projects(id) on delete set null,
 billed_client_id uuid references public.sales_clients(id) on delete set null,
 provider_client_id text,
 employee_id uuid references public.employees(id),
 period_month date check (period_month is null or extract(day from period_month)=1),
 cra_version integer,
 issue_date date,
 due_date date,
 paid_at timestamptz,
 finalized_at timestamptz,
 sent_at timestamptz,
 currency char(3) not null default 'EUR',
 total_ht numeric not null default 0,
 total_vat numeric not null default 0,
 total_ttc numeric not null default 0,
 purchase_order text not null default '',
 invoice_url text,
 ignored boolean not null default false,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(provider, provider_invoice_id),
 check (source<>'cra' or (project_id is not null and employee_id is not null and period_month is not null))
);
create unique index invoices_one_per_consultant_month on public.invoices(project_id, employee_id, period_month) where source='cra' and status<>'canceled';
create index invoices_employee_month on public.invoices(employee_id, period_month);

create table public.invoice_lines (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 position int not null,
 title text not null,
 description text not null default '',
 quantity numeric not null,
 unit text not null,
 unit_price numeric not null,
 vat_rate numeric not null,
 pricing_line text not null default '',
 computed_quantity numeric,
 computed_unit_price numeric
);
create index invoice_lines_invoice on public.invoice_lines(invoice_id);

create table public.invoice_events (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 kind text not null,
 actor uuid,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index invoice_events_invoice on public.invoice_events(invoice_id);

alter table public.invoicing_settings enable row level security;
alter table public.invoicing_client_links enable row level security;
alter table public.invoicing_product_links enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_events enable row level security;

create policy invoicing_settings_admin on public.invoicing_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoicing_client_links_admin on public.invoicing_client_links for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoicing_product_links_admin on public.invoicing_product_links for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoices_admin on public.invoices for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoice_lines_admin on public.invoice_lines for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoice_events_admin on public.invoice_events for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.invoicing_settings, public.invoicing_client_links, public.invoicing_product_links, public.invoices, public.invoice_lines, public.invoice_events from anon;
grant select, insert, update, delete on public.invoicing_settings, public.invoicing_client_links, public.invoicing_product_links, public.invoices, public.invoice_lines, public.invoice_events to authenticated;

-- A month with a finalized or paid invoice is locked for the consultant.
create function private.cra_invoiced(employee uuid, month date) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.invoices where employee_id=employee and period_month=month and status in ('finalized','paid'));
$$;
revoke all on function private.cra_invoiced(uuid, date) from public;
grant execute on function private.cra_invoiced(uuid, date) to authenticated;

create or replace function public.cra_month_snapshot(target_employee uuid, target_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.cra_access(target_employee) then raise exception 'You cannot access this employee CRA.'; end if;
 if target_month is null or extract(day from target_month)<>1 then raise exception 'Choose the first day of a month.'; end if;
 return jsonb_build_object(
  'version',coalesce((select version from public.cra_months where employee_id=target_employee and month=target_month),0),
  'invoiced',private.cra_invoiced(target_employee,target_month),
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
 if not (private.is_admin() or private.hr_operator()) and private.cra_invoiced(target_employee,target_month) then raise exception 'This CRA month has been invoiced and is locked. Ask an admin to change it.'; end if;
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
