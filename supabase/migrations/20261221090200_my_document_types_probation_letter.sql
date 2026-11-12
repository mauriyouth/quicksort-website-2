-- The probation letter is signed through Youtrust and filed by HR, like the
-- employment contract: employees cannot upload one themselves. Same view as
-- 20261214090000_my_document_types_relevant.sql with PROBATION_LETTER added to
-- the self_upload exclusion; the columns are unchanged, so create or replace
-- keeps the view's grants.
create or replace view public.my_document_types as
  with tokens as (
    select e.contract_type as token
      from public.employees e
     where e.contract_type is not null and e.contract_type <> ''
       and e.status <> 'ended'
       and exists (select 1 from public.hr_person_accounts m where m.person_id = e.person_id and m.profile_id = private.workspace_user_id())
    union
    select 'non_eu'
      from public.employees e
     where private.needs_residence_permit(e.nationality)
       and e.status <> 'ended'
       and exists (select 1 from public.hr_person_accounts m where m.person_id = e.person_id and m.profile_id = private.workspace_user_id())
  ), mine as (
    select coalesce((select array_agg(token) from tokens), '{}') as tokens
  )
  select t.code,
         t.label,
         t.folder,
         t.requirement_group,
         t.requires_expiry,
         t.warn_days,
         t.sensitive,
         t.position,
         t.required_for && mine.tokens as required,
         t.code not in ('EMPLOYMENT_CONTRACT', 'PROBATION_LETTER', 'EMPLOYMENT_AVENANT', 'FREELANCE_CONTRACT', 'EXIT_DOCUMENT', 'PAYSLIP', 'PHOTO') as self_upload,
         (t.required_for && mine.tokens)
           or (cardinality(t.required_for) = 0 and (t.code <> 'RC_PRO' or 'Freelance' = any(mine.tokens)))
           or (cardinality(mine.tokens) = 0 and t.required_for && array['CDI', 'CDD', 'Internship', 'Apprenticeship']) as relevant
    from public.document_types t, mine
   where 'person' = any(t.owner_kinds) and t.code <> 'PAYSLIP';

notify pgrst, 'reload schema';
