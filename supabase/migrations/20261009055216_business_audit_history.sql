create table public.business_audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  entity_slug text,
  entity_name text,
  section text not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  actor_id uuid references public.profiles(id),
  actor_email text not null default '',
  created_at timestamptz not null default now()
);

create index business_audit_logs_entity_idx
on public.business_audit_logs(entity_type, entity_id, created_at desc);
create index business_audit_logs_created_idx
on public.business_audit_logs(created_at desc);

alter table public.business_audit_logs enable row level security;

create policy business_audit_logs_admin_read
on public.business_audit_logs for select to authenticated
using ((select private.is_admin()));

revoke all on public.business_audit_logs from public, anon, authenticated;
grant select on public.business_audit_logs to authenticated;

create or replace function private.log_workspace_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_data jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_data jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  record_data jsonb := case when tg_op = 'DELETE' then before_data else after_data end;
  changed_values jsonb;
  current_actor uuid := private.current_user_id();
  current_actor_email text := '';
  record_id uuid;
  record_name text;
  record_section text;
begin
  if current_actor is not null then
    select p.email into current_actor_email from public.profiles p where p.id = current_actor;
  end if;

  record_id := nullif(coalesce(record_data ->> 'id', record_data ->> 'candidate_id'), '')::uuid;
  record_name := coalesce(record_data ->> 'name', record_data ->> 'title', record_data ->> 'slug', 'Record');
  if record_data ? 'candidate_id' then
    select coalesce(p.full_name, p.email, record_name) into record_name
    from public.profiles p where p.id = (record_data ->> 'candidate_id')::uuid;
  end if;

  record_section := case tg_table_name
    when 'business_accounts' then 'Account intelligence'
    when 'business_leads' then 'Leads'
    when 'business_partners' then 'Business partners'
    when 'candidate_profiles' then 'Candidate profile'
    when 'candidate_skills' then 'Capabilities · skills'
    when 'candidate_projects' then 'Capabilities · projects'
    else initcap(replace(tg_table_name, '_', ' '))
  end;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(item.key, jsonb_build_object('before', before_data -> item.key, 'after', item.value)), '{}'::jsonb)
    into changed_values
    from jsonb_each(after_data) item
    where item.key not in ('created_at', 'updated_at', 'created_by', 'updated_by')
      and before_data -> item.key is distinct from item.value;
  elsif tg_op = 'INSERT' then
    changed_values := jsonb_build_object('created', after_data - array['created_at', 'updated_at', 'created_by', 'updated_by']);
  else
    changed_values := jsonb_build_object('deleted', before_data - array['created_at', 'updated_at', 'created_by', 'updated_by']);
  end if;

  if tg_op <> 'UPDATE' or changed_values <> '{}'::jsonb then
    insert into public.business_audit_logs (
      entity_type, entity_id, entity_slug, entity_name, section, action, changes, actor_id, actor_email
    ) values (
      tg_table_name,
      record_id,
      record_data ->> 'slug',
      record_name,
      record_section,
      case when tg_op = 'INSERT' then 'created' when tg_op = 'UPDATE' then 'updated' else 'deleted' end,
      changed_values,
      current_actor,
      coalesce(current_actor_email, '')
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.log_workspace_change() from public, anon, authenticated;

create trigger business_accounts_audit after insert or update or delete on public.business_accounts
for each row execute function private.log_workspace_change();
create trigger business_leads_audit after insert or update or delete on public.business_leads
for each row execute function private.log_workspace_change();
create trigger business_partners_audit after insert or update or delete on public.business_partners
for each row execute function private.log_workspace_change();
create trigger candidate_profiles_audit after insert or update or delete on public.candidate_profiles
for each row execute function private.log_workspace_change();
create trigger candidate_skills_audit after insert or update or delete on public.candidate_skills
for each row execute function private.log_workspace_change();
create trigger candidate_projects_audit after insert or update or delete on public.candidate_projects
for each row execute function private.log_workspace_change();
