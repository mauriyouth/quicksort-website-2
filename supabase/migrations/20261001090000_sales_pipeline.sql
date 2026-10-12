-- Sales pipeline (sales.md §9): clients, people, sponsors, opportunities
-- (régie TJM × estimated days / forfait fixed price) and activities.
-- Admin-operated tables, same access model as the HR pipeline: admins manage
-- everything through RLS keyed on private.is_admin(); the API layer
-- (apps/admin/api/sales-pipeline.ts) enforces the same rules via Clerk.

create table public.sales_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  industry text not null default '' check (length(industry) <= 200),
  size text not null default '' check (length(size) <= 100),
  website text not null default '' check (length(website) <= 300),
  location text not null default '' check (length(location) <= 200),
  revenue text not null default '' check (length(revenue) <= 100),
  tags text[] not null default '{}' check (array_length(tags, 1) is null or array_length(tags, 1) <= 20),
  health text not null default 'good' check (health in ('good', 'warning', 'risk')),
  owner_email text not null default '' check (length(owner_email) <= 200),
  notes text not null default '' check (length(notes) <= 5000),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_clients enable row level security;
create index sales_clients_name_idx on public.sales_clients(name);

create table public.sales_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  role text not null default '' check (length(role) <= 200),
  client_id uuid not null references public.sales_clients(id) on delete cascade,
  email text not null default '' check (length(email) <= 200),
  phone text not null default '' check (length(phone) <= 40),
  linkedin text not null default '' check (length(linkedin) <= 300),
  is_decision_maker boolean not null default false,
  notes text not null default '' check (length(notes) <= 5000),
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_contacts enable row level security;
create index sales_contacts_client_idx on public.sales_contacts(client_id);
create index sales_contacts_email_idx on public.sales_contacts(email);

-- Opportunities with the two pricing models from sales.md §8.7:
-- régie = TJM × estimated days; forfait = fixed price. The amount column is
-- derived, never entered by hand; the CHECK rules make the pricing fields
-- mandatory per model.
create table public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  client_id uuid not null references public.sales_clients(id) on delete cascade,
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
  stage text not null default 'lead' check (stage in (
    'lead', 'qualified', 'meeting', 'proposal', 'negotiation', 'won', 'lost')),
  probability integer not null default 10 check (probability between 0 and 100),
  expected_close date,
  owner_email text not null default '' check (length(owner_email) <= 200),
  lost_reason text not null default '' check (length(lost_reason) <= 2000),
  notes text not null default '' check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pricing_model <> 'regie' or (tjm is not null and estimated_days is not null)),
  check (pricing_model <> 'forfait' or fixed_price is not null)
);
alter table public.sales_opportunities enable row level security;
create index sales_opportunities_stage_idx on public.sales_opportunities(stage);
create index sales_opportunities_client_idx on public.sales_opportunities(client_id);
create index sales_opportunities_expected_close_idx on public.sales_opportunities(expected_close);

-- Sponsors/champions (sales.md §8.8): people linked to an opportunity with an
-- influence level; at most one primary champion per opportunity.
create table public.sales_sponsors (
  opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  person_id uuid not null references public.sales_contacts(id) on delete cascade,
  influence text not null default 'neutral'
    check (influence in ('champion', 'supporter', 'neutral', 'blocker')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, person_id)
);
alter table public.sales_sponsors enable row level security;
create index sales_sponsors_person_idx on public.sales_sponsors(person_id);
-- Only one primary champion per opportunity.
create unique index sales_sponsors_one_primary_idx on public.sales_sponsors(opportunity_id)
  where is_primary;

-- Activity timeline (sales.md §8.9); stage changes are written by the API.
create table public.sales_activities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.sales_opportunities(id) on delete cascade,
  client_id uuid references public.sales_clients(id) on delete cascade,
  person_id uuid references public.sales_contacts(id) on delete set null,
  type text not null check (type in ('call', 'email', 'meeting', 'note', 'stage_change')),
  text text not null check (length(trim(text)) between 1 and 5000),
  author_email text not null check (length(author_email) <= 200),
  created_at timestamptz not null default now()
);
alter table public.sales_activities enable row level security;
create index sales_activities_opportunity_idx on public.sales_activities(opportunity_id, created_at);
create index sales_activities_client_idx on public.sales_activities(client_id, created_at);

create policy sales_clients_admin on public.sales_clients for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sales_contacts_admin on public.sales_contacts for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sales_opportunities_admin on public.sales_opportunities for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sales_sponsors_admin on public.sales_sponsors for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sales_activities_admin on public.sales_activities for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
