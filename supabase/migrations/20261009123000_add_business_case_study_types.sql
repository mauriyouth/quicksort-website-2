alter table public.business_case_studies
add column if not exists study_type text not null default 'Success story';

alter table public.business_case_studies
drop constraint if exists business_case_studies_study_type_check;

alter table public.business_case_studies
add constraint business_case_studies_study_type_check
check (study_type in ('Success story', 'Business case', 'Opportunity assessment', 'Strategic study'));

alter table public.business_case_studies
drop constraint if exists business_case_studies_status_check;

update public.business_case_studies
set status = 'Validated'
where status = 'Ready for website';

alter table public.business_case_studies
add constraint business_case_studies_status_check
check (status in ('Draft', 'Validated', 'Published'));

create index if not exists business_case_studies_type_idx
on public.business_case_studies(study_type, updated_at desc);
