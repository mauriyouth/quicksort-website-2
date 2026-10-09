alter table public.candidate_projects
  add column if not exists video_urls text[] not null default '{}',
  add column if not exists contributor_name text not null default '',
  add column if not exists contributor_email text not null default '';

update public.candidate_projects project
set contributor_name = coalesce(nullif(project.contributor_name, ''), profile.full_name, ''),
    contributor_email = coalesce(nullif(project.contributor_email, ''), profile.email, '')
from public.profiles profile
where profile.id = project.candidate_id;

alter table public.candidate_projects
  alter column candidate_id drop not null,
  drop constraint if exists candidate_projects_candidate_id_fkey,
  add constraint candidate_projects_candidate_id_fkey
    foreign key (candidate_id) references public.profiles(id) on delete set null,
  add constraint candidate_projects_video_urls_limit
    check (cardinality(video_urls) <= 10),
  add constraint candidate_projects_contributor_name_limit
    check (length(contributor_name) <= 200),
  add constraint candidate_projects_contributor_email_limit
    check (length(contributor_email) <= 320);

create or replace function private.snapshot_candidate_project_contributor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  contributor public.profiles%rowtype;
begin
  if new.candidate_id is not null then
    select * into contributor from public.profiles where id = new.candidate_id;
    new.contributor_name := coalesce(nullif(new.contributor_name, ''), contributor.full_name, '');
    new.contributor_email := coalesce(nullif(new.contributor_email, ''), contributor.email, '');
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_project_contributor_snapshot on public.candidate_projects;
create trigger candidate_project_contributor_snapshot
before insert or update of candidate_id on public.candidate_projects
for each row execute function private.snapshot_candidate_project_contributor();

create index if not exists candidate_projects_updated_idx
  on public.candidate_projects (updated_at desc);
