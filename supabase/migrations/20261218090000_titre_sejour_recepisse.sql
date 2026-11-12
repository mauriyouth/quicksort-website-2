-- A récépissé de demande de titre de séjour is a temporary residence permit.
-- It gets its own type in the same requirement group as the titre de séjour,
-- so either one satisfies the non-EU requirement, and an expired permit stops
-- alerting once a more up-to-date one of the same group is on file (e.g. the
-- old récépissé after the new card arrives, or the old card while a récépissé
-- covers the renewal).

insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('TITRE_SEJOUR_RECEPISSE', 'Récépissé de titre de séjour', '{person}', 'identite', true, null, '{30}', true, '{non_eu}', 'residence', 13)
on conflict (code) do nothing;

update public.document_types set requirement_group = 'residence', updated_at = now() where code = 'TITRE_SEJOUR';

-- Récépissés were filed as "Autre" until now. Reclassify them; the guard only
-- allows type changes while a document awaits review, so it is lifted for
-- this one-off backfill.
alter table public.documents disable trigger documents_guard;
update public.documents
   set type_code = 'TITRE_SEJOUR_RECEPISSE', version = version + 1, updated_at = now()
 where type_code = 'OTHER' and owner_kind = 'person' and expires_on is not null
   and title ~* 'r[ée]c[ée]piss[ée]';
alter table public.documents enable trigger documents_guard;

create or replace view public.document_alerts with (security_invoker = true) as
with today as (select (now() at time zone 'Europe/Paris')::date as d),
expiring as (
  select
    case when d.expires_on < today.d then 'expired' else 'expiring' end as severity,
    d.expires_on - today.d as days_left,
    d.owner_kind, d.person_id, d.client_id, d.project_id, d.extension_id,
    d.type_code, t.label as type_label, d.id as document_id, d.title, d.expires_on
  from public.documents d
  join public.document_types t on t.code = d.type_code
  cross join today
  where d.status = 'active' and d.expires_on is not null
    -- Types without warn_days only alert once expired.
    and d.expires_on - today.d <= coalesce((select max(w) from unnest(t.warn_days) w), -1)
    and (d.owner_kind <> 'person' or exists (select 1 from public.employees e where e.person_id = d.person_id and e.status <> 'ended'))
    and (d.owner_kind <> 'project' or not exists (
      select 1 from public.sales_projects p join public.admin_statuses s on s.kind = 'project' and s.key = p.status
       where p.id = d.project_id and s.is_terminal))
    -- A residence permit (titre or récépissé) needs no renewal when a more
    -- up-to-date one is on file.
    and not (t.requirement_group = 'residence' and exists (
      select 1 from public.documents o join public.document_types ot on ot.code = o.type_code
       where o.person_id = d.person_id and o.id <> d.id and o.status = 'active'
         and ot.requirement_group = t.requirement_group and o.expires_on > d.expires_on))
),
person_requirements as (
  select e.person_id, coalesce(t.requirement_group, t.code) as grp,
         min(t.code) as type_code, string_agg(t.label, ' / ' order by t.position) as type_label
  from public.employees e
  join public.document_types t on 'person' = any(t.owner_kinds)
   and ((e.contract_type <> '' and e.contract_type = any(t.required_for))
        or ('non_eu' = any(t.required_for) and private.needs_residence_permit(e.nationality)))
  where e.status <> 'ended'
  group by e.person_id, coalesce(t.requirement_group, t.code)
),
missing_person as (
  select 'missing'::text as severity, null::integer as days_left, 'person'::text as owner_kind,
         r.person_id, null::uuid as client_id, null::uuid as project_id, null::uuid as extension_id,
         r.type_code, r.type_label, null::uuid as document_id, r.type_label as title, null::date as expires_on
  from person_requirements r
  where not exists (
    select 1 from public.documents d join public.document_types t on t.code = d.type_code
     where d.person_id = r.person_id and d.status = 'active' and coalesce(t.requirement_group, t.code) = r.grp)
),
missing_project as (
  select 'missing'::text, null::integer, 'project'::text,
         null::uuid, null::uuid, p.id, null::uuid,
         t.code, t.label, null::uuid, t.label, null::date
  from public.sales_projects p
  join public.document_types t on 'project' = any(t.required_for)
  where not exists (select 1 from public.admin_statuses s where s.kind = 'project' and s.key = p.status and s.is_terminal)
    and not exists (select 1 from public.documents d where d.project_id = p.id and d.type_code = t.code and d.status = 'active')
),
missing_extension as (
  select 'missing'::text, null::integer, 'project'::text,
         null::uuid, null::uuid, x.project_id, x.id,
         'AVENANT'::text, 'Avenant'::text, null::uuid, 'Avenant — ' || x.label, null::date
  from public.sales_project_extensions x
  join public.sales_projects p on p.id = x.project_id
  where x.status = 'signed'
    and not exists (select 1 from public.admin_statuses s where s.kind = 'project' and s.key = p.status and s.is_terminal)
    and not exists (select 1 from public.documents d where d.extension_id = x.id and d.status = 'active')
)
select * from expiring
union all select * from missing_person
union all select * from missing_project
union all select * from missing_extension;

grant select on public.document_alerts to authenticated;

notify pgrst, 'reload schema';
