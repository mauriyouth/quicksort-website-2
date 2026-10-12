-- Dedicated employees table. The pipeline keeps the hiring history
-- (pipeline_candidates stays untouched as the immutable-ish source of the
-- funnel); the moment a person crosses the hire gate ("Mark as hired") their
-- employment facts are copied here and this row becomes the living directory
-- record. Post-hire edits (email, role, skills, notes, parrain, dates) happen
-- against employees; interviews, offers, events and dispositions stay keyed
-- to pipeline_candidates via candidate_id. Lifecycle sync: hire (insert),
-- onboarding/probation (stage, probation_end, parrain), offboarding
-- (status → alumni) also mirror their pipeline moves here.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.pipeline_candidates(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  email text not null default '' check (length(email) <= 200),
  phone text not null default '' check (length(phone) <= 40),
  role text not null default '' check (length(role) <= 200),
  source text not null default '' check (length(source) <= 40),
  referrer text not null default '' check (length(referrer) <= 200),
  skills text not null default '' check (length(skills) <= 2000),
  notes text not null default '' check (length(notes) <= 5000),
  stage text not null default 'preboarding'
    check (stage in ('preboarding', 'onboarding', 'probation', 'confirmed', 'offboarding')),
  status text not null default 'employee' check (status in ('employee', 'alumni')),
  start_date date,
  probation_end date,
  parrain text not null default '' check (length(parrain) <= 200),
  disposition_reason text not null default '' check (length(disposition_reason) <= 2000),
  hired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employees enable row level security;

create policy employees_admin on public.employees for all to authenticated
  using (true) with check (true);

create index employees_candidate_idx on public.employees(candidate_id);

create index employees_status_idx on public.employees(status);

create index employees_stage_idx on public.employees(stage);

-- Backfill: everyone already past the hire gate gets their employee row,
-- with the role copied from the opportunity title they were hired against
-- and hired_at taken from the conversion event when available.
insert into public.employees (
  candidate_id, full_name, email, phone, role, source, referrer,
  skills, notes, stage, status, start_date, probation_end, parrain,
  disposition_reason, hired_at, created_at, updated_at
)
select
  c.id,
  c.full_name,
  c.email,
  c.phone,
  coalesce(o.title, ''),
  c.source,
  c.referrer,
  c.skills,
  c.notes,
  case when c.stage in ('preboarding', 'onboarding', 'probation', 'confirmed', 'offboarding')
    then c.stage else 'preboarding' end,
  c.person_status,
  c.start_date,
  c.probation_end,
  c.parrain,
  c.disposition_reason,
  coalesce((
    select min(e.created_at) from public.pipeline_events e
    where e.candidate_id = c.id and e.to_stage = 'preboarding'
  ), c.created_at),
  c.created_at,
  c.updated_at
from public.pipeline_candidates c
left join public.opportunities o on o.id = c.opportunity_id
where c.person_status in ('employee', 'alumni');
