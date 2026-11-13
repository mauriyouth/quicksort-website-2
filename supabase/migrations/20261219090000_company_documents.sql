-- Company documents: Quicksort's own compliance papers (attestation de
-- régularité fiscale, attestation de vigilance URSSAF, extrait Kbis,
-- assurances) and its accounts (bilans annuels, situations intermédiaires),
-- filed from Operations → Admin into a dedicated Drive folder set in
-- Settings → Google Drive.
--
-- They join the document registry as a fourth owner kind, 'company', with no
-- owner column: there is one company. The admin app uses a fixed owner id for
-- the document_folders cache (COMPANY_OWNER_ID in apps/admin). Access follows
-- private.can_manage_document, whose non-person branch is already admin-only.
-- Expiry alerts come from document_alerts unchanged; the page's checklist
-- (required_for 'company') shows what is missing.

-- Unnamed checks get generated names; find them by what they say.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname from pg_constraint
     where contype = 'c'
       and (
         (conrelid = 'public.document_types'::regclass and pg_get_constraintdef(oid) like '%owner_kinds%<@%')
         or (conrelid = 'public.documents'::regclass and pg_get_constraintdef(oid) like '%owner_kind%' and pg_get_constraintdef(oid) not like '%person_id%')
         or (conrelid = 'public.documents'::regclass and pg_get_constraintdef(oid) like '%owner_kind%person_id%client_id%project_id%')
         or (conrelid = 'public.document_folders'::regclass and pg_get_constraintdef(oid) like '%owner_kind%')
       )
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.document_types add constraint document_types_owner_kinds_check
  check (owner_kinds <@ array['person','client','project','company'] and cardinality(owner_kinds) > 0);

alter table public.documents add constraint documents_owner_kind_check
  check (owner_kind in ('person','client','project','company'));

alter table public.documents add constraint documents_owner_check check (
  (owner_kind = 'person'  and person_id  is not null and client_id is null and project_id is null and extension_id is null) or
  (owner_kind = 'client'  and client_id  is not null and person_id is null and project_id is null and extension_id is null) or
  (owner_kind = 'project' and project_id is not null and person_id is null and client_id is null) or
  (owner_kind = 'company' and person_id is null and client_id is null and project_id is null and extension_id is null)
);

alter table public.document_folders add constraint document_folders_owner_kind_check
  check (owner_kind in ('person','client','project','company','root'));

create index if not exists documents_company on public.documents(type_code) where owner_kind = 'company';

-- Folder codes map to FOLDER_LABELS in apps/admin/server/documents/folders.ts.
-- Validity is what clients and public buyers accept: Kbis under 3 months,
-- URSSAF and fiscal attestations under 6, insurance renewed yearly.
insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('ATTESTATION_FISCALE', 'Attestation de régularité fiscale', '{company}', 'fiscal',     true,  6,    '{30,7}', false, '{company}', null, 200),
  ('COMPANY_URSSAF',      'Attestation de vigilance URSSAF',   '{company}', 'urssaf',     true,  6,    '{30,7}', false, '{company}', null, 201),
  ('COMPANY_KBIS',        'Extrait Kbis',                      '{company}', 'kbis',       true,  3,    '{15}',   false, '{company}', null, 202),
  ('COMPANY_INSURANCE',   'Attestation d''assurance',          '{company}', 'assurances', true,  12,   '{30}',   false, '{company}', null, 203),
  ('ANNUAL_ACCOUNTS',     'Bilan annuel',                      '{company}', 'bilans',     false, null, '{}',     false, '{}',        null, 210),
  ('INTERIM_ACCOUNTS',    'Situation intermédiaire',           '{company}', 'bilans',     false, null, '{}',     false, '{}',        null, 211),
  ('COMPANY_OTHER',       'Autre document société',            '{company}', 'divers',     false, null, '{}',     false, '{}',        null, 290)
on conflict (code) do nothing;
