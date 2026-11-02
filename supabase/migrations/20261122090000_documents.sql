-- Document registry. Every contract, annex and employee document (ID card,
-- carte vitale, employment contract, avenants…) gets one row here, whatever
-- storage holds the bytes: Google Drive today, S3 tomorrow, and the existing
-- Supabase buckets for files registered in place. The database is the source
-- of truth for type, owner, validity and version; storage folders are only a
-- tidy mirror, and files are always reached through provider_file_id.
--
-- Documents are immutable: a renewal inserts a new row and marks the previous
-- one superseded (register_document does both atomically). Expiry and missing
-- documents are computed on read by the document_alerts view, so in-app
-- warnings need no scheduled job.

create table public.document_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label text not null check (length(trim(label)) between 1 and 120),
  owner_kinds text[] not null check (owner_kinds <@ array['person','client','project'] and cardinality(owner_kinds) > 0),
  -- Storage folder code, see FOLDER_LABELS in apps/admin/server/documents/folders.ts.
  folder text not null check (folder ~ '^[a-z_]{1,40}$'),
  requires_expiry boolean not null default false,
  default_validity_months integer check (default_validity_months is null or default_validity_months > 0),
  warn_days integer[] not null default '{}',
  -- Sensitive files (identity, social security) are only downloadable through
  -- the API, which logs every access to hr_events.
  sensitive boolean not null default false,
  -- Employment contract types (CDI, CDD, Freelance, Internship,
  -- Apprenticeship) for person documents, 'non_eu' for employees outside the
  -- EU/EEA/Switzerland (private.needs_residence_permit), or 'project' /
  -- 'client'. Drives the "missing" alerts.
  required_for text[] not null default '{}',
  -- Types sharing a group satisfy the same requirement (CNI or passport).
  requirement_group text,
  position integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('CNI',                 'Carte d''identité',              '{person}',          'identite',           true,  120,  '{90,30}',     true,  '{CDI,CDD,Internship,Apprenticeship,Freelance}', 'identity', 10),
  ('PASSPORT',            'Passeport',                      '{person}',          'identite',           true,  120,  '{90,30}',     true,  '{CDI,CDD,Internship,Apprenticeship,Freelance}', 'identity', 11),
  ('TITRE_SEJOUR',        'Titre de séjour',                '{person}',          'identite',           true,  null, '{120,60,30}', true,  '{non_eu}', null, 12),
  ('CARTE_VITALE',        'Carte Vitale',                   '{person}',          'securite_sociale',   false, null, '{}',          true,  '{CDI,CDD,Apprenticeship}', null, 20),
  ('ATTESTATION_DROITS',  'Attestation de droits',          '{person}',          'securite_sociale',   false, null, '{}',          true,  '{}', null, 21),
  ('EMPLOYMENT_CONTRACT', 'Contrat de travail',             '{person}',          'contrat_travail',    false, null, '{60,30,7}',   false, '{CDI,CDD,Internship,Apprenticeship}', null, 30),
  ('EMPLOYMENT_AVENANT',  'Avenant au contrat de travail',  '{person}',          'contrat_travail',    false, null, '{60,30,7}',   false, '{}', null, 31),
  ('FREELANCE_CONTRACT',  'Contrat de prestation',          '{person}',          'contrat_travail',    false, null, '{60,30,7}',   false, '{Freelance}', null, 32),
  ('RIB',                 'RIB',                            '{person}',          'administratif',      false, null, '{}',          false, '{CDI,CDD,Internship,Apprenticeship,Freelance}', null, 40),
  ('JUSTIF_DOMICILE',     'Justificatif de domicile',       '{person}',          'administratif',      false, null, '{}',          false, '{}', null, 41),
  ('KBIS',                'Extrait Kbis',                   '{person,client}',   'administratif',      true,  3,    '{15}',        false, '{Freelance}', null, 42),
  ('URSSAF_VIGILANCE',    'Attestation de vigilance URSSAF','{person,client}',   'administratif',      true,  6,    '{30,7}',      false, '{Freelance}', null, 43),
  ('RC_PRO',              'Attestation RC Pro',             '{person,client}',   'administratif',      true,  12,   '{30}',        false, '{}', null, 44),
  ('VISITE_MEDICALE',     'Visite médicale (aptitude)',     '{person}',          'sante',              true,  60,   '{60,30}',     false, '{CDI,CDD}', null, 50),
  ('DIPLOMA',             'Diplôme',                        '{person}',          'diplomes',           false, null, '{}',          false, '{}', null, 60),
  ('CERTIFICATION',       'Certification',                  '{person}',          'diplomes',           false, null, '{30}',        false, '{}', null, 61),
  ('EXIT_DOCUMENT',       'Document de sortie',             '{person}',          'sortie',             false, null, '{}',          false, '{}', null, 90),
  ('CLIENT_CONTRACT',     'Contrat principal',              '{project}',         'contrat',            false, null, '{60,30,7}',   false, '{project}', null, 100),
  ('ANNEX',               'Annexe',                         '{project}',         'annexes',            false, null, '{60,30,7}',   false, '{}', null, 101),
  ('AVENANT',             'Avenant',                        '{project}',         'annexes',            false, null, '{60,30,7}',   false, '{}', null, 102),
  ('PURCHASE_ORDER',      'Bon de commande',                '{project}',         'commandes',          false, null, '{30,7}',      false, '{}', null, 103),
  ('FRAMEWORK_CONTRACT',  'Contrat-cadre',                  '{client}',          'societe',            false, null, '{60,30}',     false, '{}', null, 110),
  ('NDA',                 'Accord de confidentialité',      '{client}',          'societe',            false, null, '{30}',        false, '{}', null, 111),
  ('OTHER',               'Autre',                          '{person,client,project}', 'divers',       false, null, '{}',          false, '{}', null, 999);

alter table public.document_types enable row level security;
create policy document_types_read on public.document_types for select to authenticated
  using ((select private.is_admin()) or (select private.hr_operator()));
create policy document_types_admin on public.document_types for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  type_code text not null references public.document_types(code),
  owner_kind text not null check (owner_kind in ('person','client','project')),
  person_id uuid references public.hr_people(id),
  client_id uuid references public.sales_clients(id),
  project_id uuid references public.sales_projects(id),
  -- An avenant may formalise a project extension.
  extension_id uuid references public.sales_project_extensions(id),
  -- Annexes and avenants point to their main contract.
  parent_document_id uuid references public.documents(id),
  title text not null check (length(trim(title)) between 1 and 200),
  status text not null default 'active' check (status in ('active','superseded','archived')),
  issued_on date,
  valid_from date,
  expires_on date,
  superseded_by uuid references public.documents(id),
  needs_review boolean not null default false,
  notes text not null default '' check (length(notes) <= 2000),
  storage_provider text not null check (storage_provider in ('gdrive','s3','supabase')),
  -- Drive file id, S3 object key, or "<bucket>/<path>" for Supabase Storage.
  provider_file_id text not null check (length(provider_file_id) between 1 and 1024),
  provider_folder_id text,
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  mime_type text not null default '',
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references public.profiles(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_kind = 'person'  and person_id  is not null and client_id is null and project_id is null and extension_id is null) or
    (owner_kind = 'client'  and client_id  is not null and person_id is null and project_id is null and extension_id is null) or
    (owner_kind = 'project' and project_id is not null and person_id is null and client_id is null)
  ),
  check (expires_on is null or valid_from is null or expires_on >= valid_from),
  check (parent_document_id is distinct from id),
  check ((status = 'superseded') = (superseded_by is not null)),
  unique (storage_provider, provider_file_id)
);
create index documents_person on public.documents(person_id) where person_id is not null;
create index documents_client on public.documents(client_id) where client_id is not null;
create index documents_project on public.documents(project_id) where project_id is not null;
create index documents_parent on public.documents(parent_document_id) where parent_document_id is not null;
create index documents_expiry on public.documents(expires_on) where status = 'active' and expires_on is not null;

-- Owner, type and file columns never change once registered: replacing a file
-- is a new document. Only metadata (title, dates, notes, status, links) moves.
-- The one allowed storage change is the S3 migration: same bytes (sha256 kept),
-- new provider and key.
create function private.documents_guard() returns trigger language plpgsql set search_path='' as $$
declare
  moved boolean := (new.storage_provider, new.provider_file_id) is distinct from (old.storage_provider, old.provider_file_id);
  t public.document_types;
begin
  -- Classifying a file registered for review (needs_review → false) is the
  -- one time its type may change, under the same rules as register_document.
  if new.type_code is distinct from old.type_code then
    if not (old.needs_review and not new.needs_review) then
      raise exception 'Document file and owner are immutable; register a new document instead.';
    end if;
    select * into t from public.document_types where code = new.type_code;
    if not new.owner_kind = any(t.owner_kinds) then raise exception '% cannot belong to a %.', t.label, new.owner_kind; end if;
  end if;
  select * into t from public.document_types where code = new.type_code;
  if t.requires_expiry and new.expires_on is null and new.status = 'active' then
    raise exception '% needs an expiry date.', t.label;
  end if;
  if (new.owner_kind, new.person_id, new.client_id, new.project_id, new.uploaded_by, new.created_at)
     is distinct from (old.owner_kind, old.person_id, old.client_id, old.project_id, old.uploaded_by, old.created_at)
     or (old.sha256 is not null and new.sha256 is distinct from old.sha256)
     or (moved and not (new.storage_provider = 's3' and old.storage_provider <> 's3' and new.sha256 is not null)) then
    raise exception 'Document file and owner are immutable; register a new document instead.';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end; $$;
revoke all on function private.documents_guard() from public;
create trigger documents_guard before update on public.documents for each row execute function private.documents_guard();

-- Person documents are HR data; client and project documents follow the sales
-- tables (admin). No delete policy: documents are archived, never deleted.
create function private.can_manage_document(kind text) returns boolean language sql stable security definer set search_path='' as $$
  select case when kind = 'person' then private.hr_operator() else private.is_admin() end
$$;
revoke all on function private.can_manage_document(text) from public;
grant execute on function private.can_manage_document(text) to authenticated;

alter table public.documents enable row level security;
create policy documents_read on public.documents for select to authenticated
  using ((select private.can_manage_document(owner_kind)));
create policy documents_update on public.documents for update to authenticated
  using ((select private.can_manage_document(owner_kind))) with check ((select private.can_manage_document(owner_kind)));

-- Cache of storage folders per owner, so an upload does not walk Drive.
-- folder_code '' is the owner's root folder (e.g. "<Client>/<Project>").
create table public.document_folders (
  storage_provider text not null check (storage_provider in ('gdrive','s3')),
  owner_kind text not null check (owner_kind in ('person','client','project','root')),
  owner_id uuid,
  folder_code text not null default '',
  provider_folder_id text not null,
  folder_name text not null default '',
  folder_link text not null default '',
  created_at timestamptz not null default now(),
  unique nulls not distinct (storage_provider, owner_kind, owner_id, folder_code)
);
alter table public.document_folders enable row level security;
create policy document_folders_manage on public.document_folders for all to authenticated
  using ((select private.can_manage_document(case when owner_kind = 'root' then 'client' else owner_kind end)))
  with check ((select private.can_manage_document(case when owner_kind = 'root' then 'client' else owner_kind end)));

insert into public.document_folders (storage_provider, owner_kind, owner_id, folder_code, provider_folder_id, folder_name, folder_link)
select 'gdrive', 'project', id, '', drive_folder_id, coalesce(drive_folder_name, ''), coalesce(drive_folder_link, '')
  from public.sales_projects where drive_folder_id is not null;

-- HR operators upload person documents through /api/documents, which needs the
-- Drive connection. The row is ciphertext only the API can decrypt.
create policy google_drive_settings_hr_read on public.google_drive_settings for select to authenticated
  using ((select private.hr_operator()));

-- Registers an uploaded file. With supersedes, the previous version is marked
-- superseded in the same transaction so its expiry alert disappears at once.
-- Person documents also append an hr_events row for the HR audit trail.
create function public.register_document(document jsonb, supersedes uuid default null, request_id uuid default gen_random_uuid())
returns public.documents language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  kind text := document->>'owner_kind';
  t public.document_types;
  prev public.documents;
  doc public.documents;
  open_employee uuid;
begin
  if actor is null then raise exception 'Authentication is required.'; end if;
  if not private.can_manage_document(kind) then raise exception 'Not allowed to manage % documents.', coalesce(kind, 'these'); end if;
  select * into t from public.document_types where code = document->>'type_code';
  if not found then raise exception 'Unknown document type.'; end if;
  if not kind = any(t.owner_kinds) then raise exception '% cannot belong to a %.', t.label, kind; end if;
  if t.requires_expiry and nullif(document->>'expires_on', '') is null then raise exception '% needs an expiry date.', t.label; end if;

  if supersedes is not null then
    select * into prev from public.documents where id = supersedes for update;
    if not found or prev.status <> 'active' then raise exception 'Only an active document can be renewed.'; end if;
    if prev.owner_kind <> kind or prev.person_id is distinct from (document->>'person_id')::uuid
       or prev.client_id is distinct from (document->>'client_id')::uuid or prev.project_id is distinct from (document->>'project_id')::uuid then
      raise exception 'A renewal must keep the same owner.';
    end if;
  end if;

  insert into public.documents (
    type_code, owner_kind, person_id, client_id, project_id, extension_id, parent_document_id, title,
    issued_on, valid_from, expires_on, needs_review, notes, storage_provider, provider_file_id, provider_folder_id,
    file_name, mime_type, size_bytes, sha256, uploaded_by
  ) values (
    t.code, kind, (document->>'person_id')::uuid, (document->>'client_id')::uuid, (document->>'project_id')::uuid,
    (document->>'extension_id')::uuid, coalesce((document->>'parent_document_id')::uuid, prev.parent_document_id),
    document->>'title', nullif(document->>'issued_on', '')::date, nullif(document->>'valid_from', '')::date,
    nullif(document->>'expires_on', '')::date, coalesce((document->>'needs_review')::boolean, false),
    coalesce(document->>'notes', ''), document->>'storage_provider', document->>'provider_file_id',
    document->>'provider_folder_id', document->>'file_name', coalesce(document->>'mime_type', ''),
    (document->>'size_bytes')::bigint, document->>'sha256', actor
  ) returning * into doc;

  if supersedes is not null then
    update public.documents set status = 'superseded', superseded_by = doc.id where id = supersedes;
    -- Annexes of the old main contract follow the new one.
    update public.documents set parent_document_id = doc.id where parent_document_id = supersedes and status = 'active';
  end if;

  if kind = 'person' then
    select email into actor_email from public.profiles where id = actor;
    select id into open_employee from public.employees where person_id = doc.person_id and status <> 'ended';
    insert into public.hr_events (person_id, employee_id, kind, previous_state, next_state, actor_id, actor_email, rationale, request_id)
    values (doc.person_id, open_employee, 'document_registered', coalesce(prev.id::text, ''), doc.id::text, actor,
            coalesce(actor_email, ''), t.label || ': ' || doc.title, request_id);
  end if;
  return doc;
end; $$;
revoke all on function public.register_document(jsonb, uuid, uuid) from public;
grant execute on function public.register_document(jsonb, uuid, uuid) to authenticated;

-- Logs a download of a sensitive person document (called by the API proxy).
create function public.log_document_access(document_id uuid, request_id uuid default gen_random_uuid())
returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  actor_email text;
  doc public.documents;
begin
  select * into doc from public.documents where id = document_id;
  if not found or not private.can_manage_document(doc.owner_kind) then raise exception 'Document not available.'; end if;
  if doc.owner_kind <> 'person' then return; end if;
  select email into actor_email from public.profiles where id = actor;
  insert into public.hr_events (person_id, kind, next_state, actor_id, actor_email, request_id)
  values (doc.person_id, 'document_accessed', doc.id::text, actor, coalesce(actor_email, ''), request_id);
end; $$;
revoke all on function public.log_document_access(uuid, uuid) from public;
grant execute on function public.log_document_access(uuid, uuid) to authenticated;

-- One row per warning: an active document expired or inside its warning
-- window, or a required document missing for an open employment, a running
-- project or a signed extension. security_invoker keeps the table policies, so
-- HR operators see person alerts and admins see sales alerts.
create view public.document_alerts with (security_invoker = true) as
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

-- Inserts go through register_document only; documents are never deleted.
grant select, insert, update, delete on public.document_types, public.document_folders to authenticated;
grant select, update on public.documents to authenticated;
grant select on public.document_alerts to authenticated;

notify pgrst, 'reload schema';
