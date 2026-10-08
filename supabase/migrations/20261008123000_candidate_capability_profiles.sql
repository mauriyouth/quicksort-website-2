-- Candidate-owned capability profiles, reviewed by admins before Business can use them.
create table public.candidate_profiles (
  candidate_id uuid primary key references public.profiles(id) on delete cascade,
  headline text not null default '' check (length(headline) <= 200),
  bio text not null default '' check (length(bio) <= 3000),
  location text not null default '' check (length(location) <= 200),
  linkedin_url text not null default '' check (linkedin_url = '' or linkedin_url ~ '^https://(www\.)?linkedin\.com/[^[:space:]]+$'),
  availability text not null default '' check (length(availability) <= 200),
  review_status text not null default 'draft' check (review_status in ('draft', 'in_review', 'approved')),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null default private.current_user_id() references public.profiles(id) on delete cascade,
  vertical text not null check (vertical in ('ai_for_business', 'infrastructure_for_ai', 'data_for_ai', 'voice_ai')),
  name text not null check (length(trim(name)) between 1 and 120),
  proficiency text not null default 'Experienced' check (proficiency in ('Learning', 'Experienced', 'Advanced', 'Expert')),
  years_experience numeric(4,1) not null default 0 check (years_experience between 0 and 60),
  approved boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.candidate_projects (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null default private.current_user_id() references public.profiles(id) on delete cascade,
  vertical text not null check (vertical in ('ai_for_business', 'infrastructure_for_ai', 'data_for_ai', 'voice_ai')),
  title text not null check (length(trim(title)) between 1 and 200),
  client_name text not null default '' check (length(client_name) <= 200),
  summary text not null check (length(trim(summary)) between 1 and 3000),
  outcome text not null default '' check (length(outcome) <= 1000),
  technologies text[] not null default '{}',
  project_url text not null default '' check (project_url = '' or project_url ~ '^https?://[^[:space:]]+$'),
  approved boolean not null default false,
  updated_at timestamptz not null default now()
);

create index candidate_skills_candidate_idx on public.candidate_skills(candidate_id);
create index candidate_skills_approved_vertical_idx on public.candidate_skills(vertical) where approved;
create index candidate_projects_candidate_idx on public.candidate_projects(candidate_id);
create index candidate_projects_approved_vertical_idx on public.candidate_projects(vertical) where approved;
create index candidate_profiles_approved_by_idx on public.candidate_profiles(approved_by) where approved_by is not null;

alter table public.candidate_profiles enable row level security;
alter table public.candidate_skills enable row level security;
alter table public.candidate_projects enable row level security;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (id = (select private.current_user_id()) or (select private.is_admin()))
with check (id = (select private.current_user_id()) or (select private.is_admin()));

create policy candidate_profiles_read on public.candidate_profiles for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_profiles_insert on public.candidate_profiles for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_profiles_update on public.candidate_profiles for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

create policy candidate_skills_read on public.candidate_skills for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_insert on public.candidate_skills for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_update on public.candidate_skills for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_skills_delete on public.candidate_skills for delete to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

create policy candidate_projects_read on public.candidate_projects for select to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_insert on public.candidate_projects for insert to authenticated
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_update on public.candidate_projects for update to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()))
with check (candidate_id = (select private.current_user_id()) or (select private.is_admin()));
create policy candidate_projects_delete on public.candidate_projects for delete to authenticated
using (candidate_id = (select private.current_user_id()) or (select private.is_admin()));

-- Candidate edits always return content to review. Admin edits retain the current decision.
create function private.mark_candidate_capability_for_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if not private.is_admin() then
    if tg_table_name = 'candidate_profiles' then
      new.review_status := 'in_review';
      new.approved_at := null;
      new.approved_by := null;
    else
      new.approved := false;
    end if;
  end if;
  return new;
end;
$$;

create trigger candidate_profile_review before insert or update on public.candidate_profiles
for each row execute function private.mark_candidate_capability_for_review();
create trigger candidate_skill_review before insert or update on public.candidate_skills
for each row execute function private.mark_candidate_capability_for_review();
create trigger candidate_project_review before insert or update on public.candidate_projects
for each row execute function private.mark_candidate_capability_for_review();

create function public.approve_candidate_capability_profile(target_candidate uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  insert into public.candidate_profiles(candidate_id, review_status, approved_at, approved_by)
  values (target_candidate, 'approved', now(), private.current_user_id())
  on conflict (candidate_id) do update set
    review_status = 'approved', approved_at = now(), approved_by = private.current_user_id(), updated_at = now();
  update public.candidate_skills set approved = true, updated_at = now() where candidate_id = target_candidate;
  update public.candidate_projects set approved = true, updated_at = now() where candidate_id = target_candidate;
end;
$$;
revoke all on function public.approve_candidate_capability_profile(uuid) from public, anon;
grant execute on function public.approve_candidate_capability_profile(uuid) to authenticated;

create function public.get_business_capabilities() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  with verticals(id, name, short, color, description, position) as (values
    ('ai_for_business', 'AI for Business', 'AI', 'blue', 'Intelligent solutions tailored for business growth and efficiency.', 1),
    ('infrastructure_for_ai', 'Infrastructure for AI', 'Infra', 'green', 'Robust infrastructure designed for AI workloads and scalability.', 2),
    ('data_for_ai', 'Data for AI', 'Data', 'orange', 'Data preparation, management, and optimisation for AI systems.', 3),
    ('voice_ai', 'Voice AI', 'Voice', 'violet', 'Voice bots and conversational interfaces that listen, understand and act.', 4)
  )
  select jsonb_agg(jsonb_build_object(
    'id', v.id, 'name', v.name, 'short', v.short, 'color', v.color,
    'description', v.description,
    'people', (select count(distinct s.candidate_id) from public.candidate_skills s join public.candidate_profiles cp on cp.candidate_id=s.candidate_id where s.vertical=v.id and s.approved and cp.review_status='approved'),
    'projects', (select count(*) from public.candidate_projects p join public.candidate_profiles cp on cp.candidate_id=p.candidate_id where p.vertical=v.id and p.approved and cp.review_status='approved'),
    'technologies', coalesce((select jsonb_agg(distinct technology) from public.candidate_projects p join public.candidate_profiles cp on cp.candidate_id=p.candidate_id cross join lateral unnest(p.technologies) technology where p.vertical=v.id and p.approved and cp.review_status='approved' and technology<>''), '[]'::jsonb),
    'experts', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.full_name, 'role', q.headline, 'skills', q.skills)) from (
      select pr.id, pr.full_name, cp.headline, jsonb_agg(distinct s.name) skills
      from public.candidate_skills s join public.candidate_profiles cp on cp.candidate_id=s.candidate_id join public.profiles pr on pr.id=s.candidate_id
      where s.vertical=v.id and s.approved and cp.review_status='approved'
      group by pr.id, pr.full_name, cp.headline order by pr.full_name
    ) q), '[]'::jsonb)
  ) order by v.position) into result from verticals v;
  return coalesce(result, '[]'::jsonb);
end;
$$;
revoke all on function public.get_business_capabilities() from public, anon;
grant execute on function public.get_business_capabilities() to authenticated;

revoke all on public.candidate_profiles, public.candidate_skills, public.candidate_projects from anon, authenticated;
grant select, insert, update on public.candidate_profiles to authenticated;
grant select, insert, update, delete on public.candidate_skills, public.candidate_projects to authenticated;
