-- Contract signing through Youtrust. Admins pick a Google Doc template (or
-- upload a PDF), the server fills it, sends it to Youtrust and tracks the
-- request here. On completion a webhook, running as the service role with no
-- signed-in user, files the signed PDF and audit trail in the document
-- registry through register_signed_document, as the admin who sent it.

-- Server-only settings: Youtrust options (staging, Quicksort signatory) and
-- the encrypted API key and webhook secret. No policy, like ai_settings.
create table public.signature_settings (
  id text primary key default 'default',
  -- { staging: boolean, signatory_name: string, signatory_email: string }
  options jsonb not null default '{}',
  encrypted_credentials text,
  updated_at timestamptz not null default now()
);

create table public.signature_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  google_doc_id text not null,
  signers text not null check (signers in ('person_and_quicksort','person','quicksort')),
  type_code text not null references public.document_types(code),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hr_people(id),
  -- Null for a custom PDF.
  template_id uuid references public.signature_templates(id),
  title text not null,
  type_code text not null references public.document_types(code),
  -- [{ role: 'person'|'quicksort', name, email, order }]
  signers jsonb not null,
  field_values jsonb not null default '{}',
  -- The person's document the signed copy replaces once filed, if any.
  supersedes uuid references public.documents(id),
  status text not null check (status in ('draft','sending','sent','signed_by_person','completed','declined','expired','cancelled','error')),
  error text not null default '',
  youtrust_request_id text unique,
  youtrust_document_id text,
  -- Drive files: the filled Doc copy and the exact PDF sent.
  doc_copy_file_id text,
  pdf_file_id text,
  pdf_folder_id text,
  signed_document_id uuid references public.documents(id),
  audit_document_id uuid references public.documents(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);
create index signature_requests_person on public.signature_requests(person_id, created_at);

-- Youtrust event ids already handled, so a redelivered webhook is a no-op.
create table public.signature_webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

create function private.signature_touch() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at := now();
  if tg_table_name = 'signature_requests' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end; $$;
revoke all on function private.signature_touch() from public, anon, authenticated;
create trigger signature_settings_touch before update on public.signature_settings for each row execute function private.signature_touch();
create trigger signature_templates_touch before update on public.signature_templates for each row execute function private.signature_touch();
create trigger signature_requests_touch before update on public.signature_requests for each row execute function private.signature_touch();

alter table public.signature_settings enable row level security;
alter table public.signature_templates enable row level security;
alter table public.signature_requests enable row level security;
alter table public.signature_webhook_events enable row level security;
create policy signature_templates_admin on public.signature_templates for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy signature_requests_admin on public.signature_requests for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.signature_settings, public.signature_templates, public.signature_requests, public.signature_webhook_events from anon, authenticated;
grant select, insert, update, delete on public.signature_templates, public.signature_requests to authenticated;
grant select, insert, update, delete on public.signature_settings, public.signature_templates, public.signature_requests, public.signature_webhook_events to service_role;

insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('PROBATION_LETTER', 'Courrier période d''essai', '{person}', 'contrat_travail', false, null, '{}', false, '{}', null, 35)
on conflict (code) do nothing;

-- The insert half of register_document, with the actor passed in so the
-- service role can file on behalf of the admin who sent a signature request.
-- Callers check permissions first.
create function private.insert_document(document jsonb, supersedes uuid, request_id uuid, actor uuid)
returns public.documents language plpgsql security definer set search_path='' as $$
declare
  actor_email text;
  kind text := document->>'owner_kind';
  t public.document_types;
  prev public.documents;
  doc public.documents;
  open_employee uuid;
begin
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
revoke all on function private.insert_document(jsonb, uuid, uuid, uuid) from public, anon, authenticated;

-- Same signature, grants and behaviour as before; the insert moved above.
create or replace function public.register_document(document jsonb, supersedes uuid default null, request_id uuid default gen_random_uuid())
returns public.documents language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.workspace_user_id();
  kind text := document->>'owner_kind';
begin
  if actor is null then raise exception 'Authentication is required.'; end if;
  if not private.can_manage_document(kind) then raise exception 'Not allowed to manage % documents.', coalesce(kind, 'these'); end if;
  return private.insert_document(document, supersedes, request_id, actor);
end; $$;

-- Files a document for a signature request from the Youtrust webhook (service
-- role, no user). The admin who sent the request is the uploader and actor,
-- and the request id ties the hr_events row back to it.
create function public.register_signed_document(signature_request uuid, document jsonb, supersedes uuid default null)
returns public.documents language plpgsql security definer set search_path='' as $$
declare
  request public.signature_requests;
begin
  select * into request from public.signature_requests where id = signature_request;
  if not found then raise exception 'Unknown signature request.'; end if;
  if document->>'owner_kind' is distinct from 'person' or (document->>'person_id')::uuid is distinct from request.person_id then
    raise exception 'Document does not belong to this signature request.';
  end if;
  return private.insert_document(document, supersedes, signature_request, request.created_by);
end; $$;
revoke all on function public.register_signed_document(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.register_signed_document(uuid, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
