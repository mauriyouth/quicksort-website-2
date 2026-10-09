alter table public.business_partners
  add column if not exists account_links jsonb not null default '[]'::jsonb;

alter table public.business_partners
  add constraint business_partners_account_links_array
  check (jsonb_typeof(account_links) = 'array');
