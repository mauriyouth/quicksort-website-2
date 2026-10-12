-- Project extensions (renewals). A delivery project (sales.md §14 Phase 2)
-- can be extended one or more times — each extension is an additional
-- period with its own dates and pricing, following the same régie/forfait
-- rules as the origin project and opportunity (§8.7 derived amount). Only
-- 'signed' extensions count toward the extended timeline and value shown in
-- the Sales UI; 'planned' is a renewal being negotiated, 'cancelled' keeps
-- the audit trail. Admin-operated table, same access model as
-- sales_projects (RLS on private.is_admin()).

create table public.sales_project_extensions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.sales_projects(id) on delete cascade,
  label text not null default '' check (length(label) <= 200),
  pricing_model text not null check (pricing_model in ('regie', 'forfait')),
  currency char(3) not null default 'EUR',
  tjm numeric check (tjm is null or tjm >= 0),
  estimated_days numeric check (estimated_days is null or estimated_days >= 0),
  fixed_price numeric check (fixed_price is null or fixed_price >= 0),
  amount numeric not null generated always as (
    case pricing_model
      when 'regie' then coalesce(tjm, 0) * coalesce(estimated_days, 0)
      else coalesce(fixed_price, 0)
    end
  ) stored,
  status text not null default 'signed' check (status in ('planned', 'signed', 'cancelled')),
  start_date date,
  end_date date,
  notes text not null default '' check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pricing_model <> 'regie' or (tjm is not null and estimated_days is not null)),
  check (pricing_model <> 'forfait' or fixed_price is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);
alter table public.sales_project_extensions enable row level security;
create index sales_project_extensions_project_idx on public.sales_project_extensions(project_id);

create policy sales_project_extensions_admin on public.sales_project_extensions for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
