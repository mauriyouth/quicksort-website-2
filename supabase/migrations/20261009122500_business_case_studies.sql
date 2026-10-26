create table if not exists public.business_case_studies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 240),
  client text not null default '',
  account_id text not null default '',
  summary text not null default '',
  challenge text not null default '',
  solution text not null default '',
  outcome text not null default '',
  evidence_url text not null default '',
  tags text[] not null default '{}',
  status text not null default 'Draft' check (status in ('Draft', 'Ready for website')),
  created_by uuid default private.current_user_id() references public.profiles(id),
  updated_by uuid default private.current_user_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_case_studies_updated_idx on public.business_case_studies(updated_at desc);
create index if not exists business_case_studies_account_idx on public.business_case_studies(account_id) where account_id <> '';

alter table public.business_case_studies enable row level security;

create policy business_case_studies_admin_all on public.business_case_studies for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger business_case_studies_touch before update on public.business_case_studies
for each row execute function private.touch_business_workspace_record();

create trigger business_case_studies_audit after insert or update or delete on public.business_case_studies
for each row execute function private.log_workspace_change();

revoke all on public.business_case_studies from anon, authenticated;
grant select, insert, update, delete on public.business_case_studies to authenticated;
