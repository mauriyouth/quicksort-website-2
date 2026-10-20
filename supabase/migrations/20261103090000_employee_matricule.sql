-- Every employee record carries a permanent matricule, assigned automatically
-- at hiring (and when historical employment is imported). The entry date is
-- the existing not-null employees.start_date. Existing rows are backfilled
-- from the sequence as the column is added.
create sequence public.employee_matricule_seq;

alter table public.employees
  add column matricule text not null unique
  default ('QS-' || lpad(nextval('public.employee_matricule_seq')::text, 4, '0'));

-- Expose the matricule on the self-service portal view.
create or replace view public.my_employment as
 select e.id,e.person_id,e.role,e.start_date,e.end_date,e.status,e.onboarding_completed_at,e.probation_status,e.probation_end,e.matricule
 from public.employees e where exists(select 1 from public.hr_person_accounts m where m.person_id=e.person_id and m.profile_id=private.workspace_user_id());
