create table public.treg_usage (
  call_id text primary key,
  request_id uuid not null,
  admin_id uuid not null references public.profiles(id),
  customer text not null check (customer = 'quicksort'),
  feature text not null,
  endpoint text not null,
  status integer not null check (status between 100 and 599),
  cost_micro bigint check (cost_micro >= 0),
  created_at timestamptz not null default now()
);
create index treg_usage_admin_created_idx on public.treg_usage(admin_id, created_at desc);
alter table public.treg_usage enable row level security;
revoke all on public.treg_usage from public, anon, authenticated;
grant select on public.treg_usage to authenticated;
grant select, insert on public.treg_usage to service_role;
create policy treg_usage_admin_read on public.treg_usage for select to authenticated
using ((select private.is_admin()));
