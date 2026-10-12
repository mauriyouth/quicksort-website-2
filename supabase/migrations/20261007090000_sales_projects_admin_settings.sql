-- Sales projects + configurable referentials (BoondManager-style "paramètres
-- globaux", sales.md §14 Phase 2). Won régie/forfait deals convert into
-- delivery projects; the admin "Global settings" screen edits the status and
-- type referentials that drive the Sales UI. Admin-operated tables, same
-- access model as the rest of the operations app (RLS on private.is_admin()).

-- Delivery projects: the operational continuation of a won sales_opportunity.
-- Amount uses the same derived-column rule as sales_opportunities (§8.7).
create table public.sales_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  client_id uuid not null references public.sales_clients(id) on delete cascade,
  opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  type text not null default '' check (length(type) <= 200),
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
  status text not null default 'en_cours' check (length(status) <= 100),
  start_date date,
  end_date date,
  owner_email text not null default '' check (length(owner_email) <= 200),
  notes text not null default '' check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pricing_model <> 'regie' or (tjm is not null and estimated_days is not null)),
  check (pricing_model <> 'forfait' or fixed_price is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);
alter table public.sales_projects enable row level security;
create index sales_projects_client_idx on public.sales_projects(client_id);
create index sales_projects_status_idx on public.sales_projects(status);
create unique index sales_projects_one_per_opportunity_idx
  on public.sales_projects(opportunity_id) where opportunity_id is not null;

-- Configurable status referentials. One row per status; `kind` selects which
-- module the status belongs to. Project statuses are fully free-form (the
-- projects table only stores the key). Opportunity/resource statuses mirror
-- keys enforced elsewhere (sales_opportunities.stage CHECK, pipeline
-- person_status) — the UI locks add/delete for those kinds and only relabels
-- and recolors them.
create table public.admin_statuses (
  kind text not null check (kind in ('project', 'opportunity', 'resource')),
  key text not null check (length(key) between 1 and 100),
  label text not null check (length(trim(label)) between 1 and 200),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  is_default boolean not null default false,
  is_terminal boolean not null default false,
  visible boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
);
alter table public.admin_statuses enable row level security;
-- One default per kind.
create unique index admin_statuses_one_default_idx on public.admin_statuses(kind)
  where is_default;

-- Configurable types for opportunities & projects (Boond "types des besoins &
-- projets"): label, billing/delivery mode, and an optional grouping type.
create table public.admin_types (
  key text primary key check (length(key) between 1 and 100),
  label text not null check (length(trim(label)) between 1 and 200),
  mode text not null default 'regie' check (mode in ('regie', 'forfait', 'recrutement', 'produit')),
  maps_to text not null default '' check (length(maps_to) <= 100),
  position integer not null default 0,
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.admin_types enable row level security;

-- Seeds: BoondManager-flavoured defaults (FR labels, matching screenshots).
insert into public.admin_statuses (kind, key, label, color, position, is_default, is_terminal, visible) values
  ('project', 'en_cours', 'En cours', '#3b82f6', 0, true, false, true),
  ('project', 'archive', 'Archivé', '#475569', 1, false, true, true),
  ('opportunity', 'lead', 'Piste identifiée', '#f59e0b', 0, true, false, true),
  ('opportunity', 'qualified', 'Qualifié', '#3b82f6', 1, false, false, true),
  ('opportunity', 'meeting', 'Rendez-vous', '#8b5cf6', 2, false, false, true),
  ('opportunity', 'proposal', 'Proposition', '#f59e0b', 3, false, false, true),
  ('opportunity', 'negotiation', 'Négociation', '#f97316', 4, false, false, true),
  ('opportunity', 'won', 'Gagné', '#16a34a', 5, false, true, true),
  ('opportunity', 'lost', 'Perdu', '#dc2626', 6, false, true, true),
  ('resource', 'candidate', 'Candidat', '#f59e0b', 0, true, false, true),
  ('resource', 'employee', 'En mission', '#16a34a', 1, false, false, true),
  ('resource', 'alumni', 'Sortie', '#475569', 2, false, true, true);

insert into public.admin_types (key, label, mode, maps_to, position, visible) values
  ('regie', 'Régie', 'regie', '', 0, true),
  ('forfait', 'Forfait', 'forfait', '', 1, true),
  ('recrutement', 'Recrutement', 'recrutement', '', 2, true),
  ('produit', 'Produit', 'produit', '', 3, true);

create policy sales_projects_admin on public.sales_projects for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_statuses_admin on public.admin_statuses for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_types_admin on public.admin_types for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
