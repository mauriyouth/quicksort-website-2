-- HR pipeline: opportunities, CVthèque, immutable pipeline events, interviews,
-- offers with margin approval chain, onboarding, reviews and offboarding.
-- Per prd-hr.md §3-§6. Admin-operated tables; candidates interact only via the HR portal.

-- Opportunitys (job offers) with mandatory hiring-mode tag (prd-hr.md §3.3).
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  hiring_mode text not null check (hiring_mode in ('sur_mission', 'sur_profil')),
  job_id uuid references public.jobs(id) on delete set null,
  client_need text not null default '' check (length(client_need) <= 5000),
  skill_family text not null default '' check (length(skill_family) <= 200),
  owner_email text not null default '' check (length(owner_email) <= 200),
  target_tjm numeric check (target_tjm is null or target_tjm >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'published', 'filled', 'cancelled')),
  justification text not null default '' check (length(justification) <= 5000),
  decided_by text not null default '' check (length(decided_by) <= 200),
  decided_at timestamptz,
  decision_rationale text not null default '' check (length(decision_rationale) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.opportunities enable row level security;
create index opportunities_status_idx on public.opportunities(status);

-- One canonical talent record: Candidate -> Employee -> Alumni (prd-hr.md §1.3, §3.1).
create table public.pipeline_candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  email text not null default '' check (length(email) <= 200),
  phone text not null default '' check (length(phone) <= 40),
  source text not null default 'career_site'
    check (source in ('career_site', 'linkedin', 'referral', 'job_board', 'spontaneous', 'rediscovery', 'other')),
  referrer text not null default '' check (length(referrer) <= 200),
  opportunity_id uuid references public.opportunities(id) on delete set null,
  stage text not null default 'application' check (stage in (
    'opportunity', 'published', 'application', 'matching', 'screening',
    'hr_interview', 'technical_interview', 'client_presentation', 'decision',
    'offer', 'contract', 'preboarding', 'onboarding', 'probation', 'confirmed',
    'offboarding')),
  person_status text not null default 'candidate' check (person_status in ('candidate', 'employee', 'alumni')),
  disposition text check (disposition in ('rejected', 'withdrawn', 'hired')),
  disposition_reason text not null default '' check (length(disposition_reason) <= 2000),
  match_score integer check (match_score is null or match_score between 0 and 100),
  match_explanation text not null default '' check (length(match_explanation) <= 5000),
  screening_summary text not null default '' check (length(screening_summary) <= 5000),
  screening_recommendation text not null default '' check (length(screening_recommendation) <= 2000),
  skills text not null default '' check (length(skills) <= 2000),
  notes text not null default '' check (length(notes) <= 5000),
  start_date date,
  probation_end date,
  parrain text not null default '' check (length(parrain) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pipeline_candidates enable row level security;
create index pipeline_candidates_stage_idx on public.pipeline_candidates(stage);
create index pipeline_candidates_opportunity_idx on public.pipeline_candidates(opportunity_id);
create index pipeline_candidates_email_idx on public.pipeline_candidates(email);

-- Immutable audit log: every transition is a timestamped, attributed event (prd-hr.md §3.2 rule 1,
-- AI Act Arts. 12/19 record-keeping). No update or delete privileges by design.
create table public.pipeline_events (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  from_stage text not null default '',
  to_stage text not null default '',
  actor_email text not null check (length(actor_email) <= 200),
  rationale text not null default '' check (length(rationale) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.pipeline_events enable row level security;
create index pipeline_events_candidate_idx on public.pipeline_events(candidate_id, created_at);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  kind text not null check (kind in ('hr', 'technical', 'client')),
  scheduled_at timestamptz not null,
  panel text not null default '' check (length(panel) <= 500),
  location text not null default '' check (length(location) <= 300),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  scorecard jsonb not null default '[]'::jsonb,
  ai_summary text not null default '' check (length(ai_summary) <= 5000),
  created_at timestamptz not null default now()
);
alter table public.interviews enable row level security;
create index interviews_candidate_idx on public.interviews(candidate_id);
create index interviews_scheduled_idx on public.interviews(scheduled_at);

-- Offers with unit economics and the HR -> Direction approval chain (prd-hr.md FR-5.3.3).
-- Healthy corridor: forecast gross margin of 25-40% of target TJM.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  contract_type text not null default 'CDI' check (contract_type in ('CDI', 'CDD', 'Freelance', 'Internship', 'Apprenticeship')),
  salary_monthly numeric not null check (salary_monthly >= 0),
  cjm numeric not null check (cjm > 0),
  target_tjm numeric not null check (target_tjm > 0),
  margin_pct numeric not null default 0 check (margin_pct between 0 and 100),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'pending_direction', 'approved', 'sent', 'accepted', 'declined', 'cancelled')),
  approver_note text not null default '' check (length(approver_note) <= 2000),
  decided_by text not null default '' check (length(decided_by) <= 200),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.offers enable row level security;
create index offers_candidate_idx on public.offers(candidate_id);

-- Pre-boarding / onboarding / probation checklists (prd-hr.md FR-6.1, FR-6.2.1).
create table public.onboarding_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  phase text not null check (phase in ('preboarding', 'onboarding', 'probation')),
  title text not null check (length(trim(title)) between 1 and 300),
  assignee text not null default '' check (length(assignee) <= 200),
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.onboarding_items enable row level security;
create index onboarding_items_candidate_idx on public.onboarding_items(candidate_id);

-- Probation and annual reviews with a logged human outcome (prd-hr.md FR-6.2.1, FR-6.2.2).
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  kind text not null check (kind in ('probation', 'annual')),
  due_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'held')),
  outcome text not null default '' check (length(outcome) <= 100),
  rationale text not null default '' check (length(rationale) <= 2000),
  held_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create index reviews_due_idx on public.reviews(due_date) where status = 'scheduled';

create table public.offboarding_records (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.pipeline_candidates(id) on delete cascade,
  kind text not null check (kind in ('resignation', 'rupture_conventionnelle', 'dismissal', 'probation_end', 'cdd_end')),
  status text not null default 'open' check (status in ('open', 'completed')),
  exit_date date not null,
  notice_end date,
  prerequis_waived boolean not null default false,
  handover_plan text not null default '' check (length(handover_plan) <= 5000),
  successor text not null default '' check (length(successor) <= 200),
  exit_interview text not null default '' check (length(exit_interview) <= 5000),
  rehire_eligible boolean,
  rehire_rationale text not null default '' check (length(rehire_rationale) <= 2000),
  legal_docs_done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.offboarding_records enable row level security;
create index offboarding_status_idx on public.offboarding_records(status);

create table public.offboarding_items (
  id uuid primary key default gen_random_uuid(),
  offboarding_id uuid not null references public.offboarding_records(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.offboarding_items enable row level security;
create index offboarding_items_record_idx on public.offboarding_items(offboarding_id);

-- Candidate-facing requests: human re-review of AI-assisted steps and GDPR rights
-- (prd-hr.md §2.2 Candidate row, FR-5.3.2, §8.2). Insert restricted to the sign-in's own email.
create table public.candidate_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) <= 200),
  kind text not null check (kind in ('human_review', 'rectification', 'erasure', 'portability', 'viewpoint')),
  message text not null default '' check (length(message) <= 3000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  admin_note text not null default '' check (length(admin_note) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.candidate_requests enable row level security;
create index candidate_requests_email_idx on public.candidate_requests(email);

-- RLS: HR pipeline tables are admin-operated. Candidates never see scores, rankings or
-- other candidates' data (prd-hr.md §2.2, FR-4.3.2).
create policy opportunities_admin on public.opportunities for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy pipeline_candidates_admin on public.pipeline_candidates for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy pipeline_events_admin_read on public.pipeline_events for select to authenticated
using ((select private.is_admin()));
-- Immutable: insert only, no update or delete grants (prd-hr.md §3.2 rule 1).
create policy pipeline_events_admin_insert on public.pipeline_events for insert to authenticated
with check ((select private.is_admin()));
create policy interviews_admin on public.interviews for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy offers_admin on public.offers for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy onboarding_items_admin on public.onboarding_items for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy reviews_admin on public.reviews for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy offboarding_admin on public.offboarding_records for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy offboarding_items_admin on public.offboarding_items for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy candidate_requests_own on public.candidate_requests for select to authenticated
using (email = (select email from public.profiles where id = (select auth.uid())) or (select private.is_admin()));
create policy candidate_requests_insert_own on public.candidate_requests for insert to authenticated
with check (email = (select email from public.profiles where id = (select auth.uid())));
create policy candidate_requests_admin_update on public.candidate_requests for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

grant select on public.opportunities, public.pipeline_candidates, public.pipeline_events,
  public.interviews, public.offers, public.onboarding_items, public.reviews,
  public.offboarding_records, public.offboarding_items, public.candidate_requests to authenticated;
grant insert, update, delete on public.opportunities, public.pipeline_candidates,
  public.interviews, public.offers, public.onboarding_items, public.reviews,
  public.offboarding_records, public.offboarding_items to authenticated;
grant insert on public.pipeline_events to authenticated;
grant insert(email, kind, message) on public.candidate_requests to authenticated;
grant update(status, admin_note) on public.candidate_requests to authenticated;

-- Candidate-facing views: a candidate sees their own stage and timeline, never
-- scores, rankings, screening content or other candidates (prd-hr.md §2.2, FR-4.3.2).
-- Views run with the owner's privileges; the email filter scopes rows to the caller.
create or replace view public.my_application as
select c.id, c.full_name, c.stage, c.start_date, c.created_at, c.updated_at
from public.pipeline_candidates c
where c.email = (select p.email from public.profiles p where p.id = (select auth.uid()));
grant select on public.my_application to authenticated;

create or replace view public.my_application_events as
select e.id, e.candidate_id, e.to_stage, e.created_at
from public.pipeline_events e
join public.pipeline_candidates c on c.id = e.candidate_id
where c.email = (select p.email from public.profiles p where p.id = (select auth.uid()));
grant select on public.my_application_events to authenticated;
