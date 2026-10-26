-- Shared Business workspace records. These tables live in the same Supabase
-- project and use the same Clerk-to-profile identity bridge as Admin/Candidate.
create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 200),
  sector text not null default '',
  contacts integer not null default 0 check (contacts >= 0),
  signal text not null default 'Not set',
  opportunity text not null default 'Not set',
  estimated_value text not null default '—',
  stage text not null default 'Not set',
  owner text not null default '—',
  fit text[] not null default '{}',
  case_studies jsonb not null default '[]'::jsonb check (jsonb_typeof(case_studies) = 'array'),
  opportunity_summary text not null default '',
  fit_score text not null default '—',
  evidence text[] not null default '{}',
  intelligence jsonb not null default '{"leads":[],"events":[],"contacts":[]}'::jsonb check (jsonb_typeof(intelligence) = 'object'),
  created_by uuid default private.current_user_id() references public.profiles(id),
  updated_by uuid default private.current_user_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  role text not null default '',
  company text not null default '',
  source text not null check (source in ('Event', 'Tool', 'Network')),
  origin text not null default '',
  score integer not null default 0 check (score between 0 and 100),
  reason text not null default '',
  stage text not null default 'New' check (stage in ('New', 'Qualified', 'Contacted', 'Converted')),
  owner text not null default '—',
  created_by uuid default private.current_user_id() references public.profiles(id),
  updated_by uuid default private.current_user_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  company text not null default '',
  role text not null default '',
  origin text not null check (length(trim(origin)) between 1 and 300),
  linkedin_url text not null default '' check (linkedin_url = '' or linkedin_url ~ '^https://(www\.)?linkedin\.com/[^[:space:]]+$'),
  email text not null default '',
  phone text not null default '',
  relationship text not null default '',
  owner text not null default '',
  notes text not null default '',
  created_by uuid default private.current_user_id() references public.profiles(id),
  updated_by uuid default private.current_user_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_accounts_updated_idx on public.business_accounts(updated_at desc);
create index if not exists business_leads_updated_idx on public.business_leads(updated_at desc);
create index if not exists business_partners_updated_idx on public.business_partners(updated_at desc);

alter table public.business_accounts enable row level security;
alter table public.business_leads enable row level security;
alter table public.business_partners enable row level security;

drop policy if exists business_accounts_admin_all on public.business_accounts;
drop policy if exists business_leads_admin_all on public.business_leads;
drop policy if exists business_partners_admin_all on public.business_partners;
create policy business_accounts_admin_all on public.business_accounts for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy business_leads_admin_all on public.business_leads for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy business_partners_admin_all on public.business_partners for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function private.touch_business_workspace_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := private.current_user_id();
  return new;
end;
$$;

drop trigger if exists business_accounts_touch on public.business_accounts;
drop trigger if exists business_leads_touch on public.business_leads;
drop trigger if exists business_partners_touch on public.business_partners;

create trigger business_accounts_touch before update on public.business_accounts
for each row execute function private.touch_business_workspace_record();
create trigger business_leads_touch before update on public.business_leads
for each row execute function private.touch_business_workspace_record();
create trigger business_partners_touch before update on public.business_partners
for each row execute function private.touch_business_workspace_record();

revoke all on public.business_accounts, public.business_leads, public.business_partners from anon, authenticated;
grant select, insert, update, delete on public.business_accounts, public.business_leads, public.business_partners to authenticated;

-- These are user-requested real account names, not demo records.
insert into public.business_accounts (slug, name, sector)
values
  ('bnp-paribas', 'BNP Paribas', 'Financial services'),
  ('axa', 'AXA', 'Insurance'),
  ('kering', 'Kering', 'Luxury'),
  ('foundever', 'Foundever', 'Customer experience'),
  ('cdg-capital-morocco', 'CDG Capital Morocco', 'Financial services'),
  ('najm', 'Najm', '')
on conflict (slug) do nothing;
