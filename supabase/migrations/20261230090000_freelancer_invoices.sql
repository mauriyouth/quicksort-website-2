-- Invoices that freelancers send us: received through the portal or read from
-- a mailbox, checked against their CRA x daily rate and matched to Qonto debits.
-- Admin only; freelancers see their own status through my_freelancer_invoices().

create table public.freelancer_billing (
 employee_id uuid primary key references public.employees(id) on delete cascade,
 company_name text not null default '',
 siret text not null default '',
 -- Uppercase, no spaces.
 iban text not null default '',
 extra_emails text[] not null default '{}',
 updated_by text,
 updated_at timestamptz not null default now()
);

create table public.freelancer_invoices (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 source text not null check (source in ('portal','email')),
 gmail_message_id text,
 document_id uuid references public.documents(id) on delete set null,
 sha256 text not null,
 number text not null default '',
 issue_date date,
 period_month date check (period_month is null or extract(day from period_month)=1),
 due_date date,
 amount_ht_cents bigint,
 vat_cents bigint,
 amount_ttc_cents bigint,
 is_credit_note boolean not null default false,
 review text not null default 'to_check' check (review in ('to_check','ok','rejected')),
 -- Why the invoice cannot be approved automatically: not_invoice, unreadable, iban_changed.
 flags text[] not null default '{}',
 review_note text not null default '',
 extraction jsonb,
 paid_at timestamptz,
 paid_by_transaction_id text references public.bank_transactions(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1,
 unique (employee_id, sha256)
);
-- A rejected invoice frees its number: the corrected one usually reuses it.
create unique index freelancer_invoices_number on public.freelancer_invoices(employee_id, number) where number <> '' and review <> 'rejected';
create index freelancer_invoices_period on public.freelancer_invoices(employee_id, period_month);
create index freelancer_invoices_gmail on public.freelancer_invoices(gmail_message_id) where gmail_message_id is not null;

create table public.freelancer_invoice_matches (
 invoice_id uuid not null references public.freelancer_invoices(id) on delete cascade,
 transaction_id text not null references public.bank_transactions(id) on delete cascade,
 kind text not null check (kind in ('confident','probable','manual')),
 state text not null default 'suggested' check (state in ('suggested','confirmed','dismissed')),
 created_at timestamptz not null default now(),
 decided_by text,
 primary key (invoice_id, transaction_id)
);
create index freelancer_invoice_matches_transaction on public.freelancer_invoice_matches(transaction_id);

create table public.freelancer_invoice_events (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.freelancer_invoices(id) on delete cascade,
 kind text not null,
 actor_email text,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index freelancer_invoice_events_invoice on public.freelancer_invoice_events(invoice_id);

create table public.freelancer_mailbox_settings (
 id text primary key default 'mailbox' check (id = 'mailbox'),
 address text not null default 'mohamed@quicksort.fr',
 backfill_from date not null default '2026-01-01',
 last_polled_at timestamptz,
 last_error text,
 locked_until timestamptz,
 updated_by text
);
insert into public.freelancer_mailbox_settings(id) values ('mailbox');

-- One row per mailbox message the poll read: 'done' ones are never read again,
-- 'failed' ones are retried (up to 5 attempts) and hold the poll window open.
create table public.freelancer_mailbox_messages (
 message_id text primary key,
 status text not null check (status in ('done','failed')),
 attempts int not null default 1,
 last_error text,
 internal_date timestamptz,
 processed_at timestamptz not null default now()
);

alter table public.freelancer_billing enable row level security;
alter table public.freelancer_invoices enable row level security;
alter table public.freelancer_invoice_matches enable row level security;
alter table public.freelancer_invoice_events enable row level security;
alter table public.freelancer_mailbox_settings enable row level security;
alter table public.freelancer_mailbox_messages enable row level security;

create policy freelancer_billing_admin on public.freelancer_billing for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy freelancer_invoices_admin on public.freelancer_invoices for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy freelancer_invoice_matches_admin on public.freelancer_invoice_matches for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy freelancer_invoice_events_admin on public.freelancer_invoice_events for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy freelancer_mailbox_settings_admin on public.freelancer_mailbox_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy freelancer_mailbox_messages_admin on public.freelancer_mailbox_messages for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.freelancer_billing, public.freelancer_invoices, public.freelancer_invoice_matches, public.freelancer_invoice_events, public.freelancer_mailbox_settings, public.freelancer_mailbox_messages from anon;
grant select, insert, update, delete on public.freelancer_billing, public.freelancer_invoices, public.freelancer_invoice_matches, public.freelancer_invoice_events, public.freelancer_mailbox_settings, public.freelancer_mailbox_messages to authenticated;
grant select, insert, update, delete on public.freelancer_billing, public.freelancer_invoices, public.freelancer_invoice_matches, public.freelancer_invoice_events, public.freelancer_mailbox_settings, public.freelancer_mailbox_messages to service_role;

insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('FREELANCE_INVOICE', 'Freelance invoice', '{person}', 'factures', false, null, '{}', false, '{}', null, 45)
on conflict (code) do nothing;

-- A freelancer's own invoices, reduced to what the portal may show.
create function public.my_freelancer_invoices() returns table (
 id uuid, number text, period_month date, amount_ttc_cents bigint, received_at timestamptz, portal_status text
) language sql stable security definer set search_path='' as $$
 select i.id, i.number, i.period_month, i.amount_ttc_cents, i.created_at,
        case when i.review='rejected' then 'not_accepted' when i.paid_at is not null then 'paid' when i.review='ok' then 'to_pay' else 'received' end
   from public.freelancer_invoices i
   join public.employees e on e.id=i.employee_id
   join public.hr_person_accounts a on a.person_id=e.person_id
  where a.profile_id=private.workspace_user_id()
  order by i.created_at desc;
$$;
revoke all on function public.my_freelancer_invoices() from public, anon;
grant execute on function public.my_freelancer_invoices() to authenticated;

-- Addresses the mailbox poller may read from: freelancers still working with
-- us (preboarding included, like the portal), and those whose freelance
-- employment ended in the last 90 days, for their final invoice. A person with
-- an open freelance employment sends for that one only, so a renewal does not
-- make their address ambiguous. Same rule as the API's callerFreelanceEmployee.
create function public.freelancer_known_senders() returns table (employee_id uuid, email text)
language sql stable security definer set search_path='' as $$
 with eligible as (
  select e.id, e.person_id, e.status <> 'ended' as open
    from public.employees e
   where e.contract_type='Freelance'
     and (e.status in ('preboarding','active','offboarding') or (e.status='ended' and e.end_date >= current_date - 90))
 ), chosen as (
  select g.id, g.person_id from eligible g
   where g.open or not exists (select 1 from eligible o where o.person_id=g.person_id and o.open)
 )
 select distinct s.employee_id, s.email from (
  select c.id as employee_id, lower(trim(p.email)) as email
    from chosen c join public.hr_people p on p.id=c.person_id
  union all
  select c.id, lower(trim(x))
    from chosen c join public.freelancer_billing b on b.employee_id=c.id, unnest(b.extra_emails) x
 ) s where s.email <> '';
$$;
revoke all on function public.freelancer_known_senders() from public, anon, authenticated;
grant execute on function public.freelancer_known_senders() to service_role;

-- Marks invoices paid by one debit, atomically. A debit pays at most one
-- invoice unless an admin links it to several in one call: the advisory lock
-- serialises every writer of the same debit, so two concurrent confirmations
-- cannot both pass the "debit still free" check.
-- Errors: 42501 not allowed, P0404 unknown invoice, P0409 debit used or invoice paid/rejected.
create function public.freelancer_invoice_mark_paid(
 invoice_ids uuid[], transaction_id text, match_kind text, actor text, paid_at timestamptz
) returns int language plpgsql security definer set search_path='' as $$
declare
 v_ids uuid[] := array(select distinct x from unnest(invoice_ids) x where x is not null);
 v_found int;
 v_event text;
begin
 if not (private.is_admin()
   or coalesce(current_setting('role', true), '') = 'service_role'
   or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') then
  raise exception using errcode = '42501', message = 'Administrator access required';
 end if;
 if cardinality(v_ids) = 0 or transaction_id is null or paid_at is null then
  raise exception using errcode = '22023', message = 'Invoices, debit and payment date are required';
 end if;
 v_event := case match_kind when 'confident' then 'paid_auto' when 'probable' then 'paid_confirmed' when 'manual' then 'paid_linked' end;
 if v_event is null then raise exception using errcode = '22023', message = 'Unknown match kind'; end if;

 perform pg_advisory_xact_lock(hashtext('fi-debit:' || transaction_id));

 -- Locked in id order, so two calls over overlapping invoices cannot deadlock.
 select count(*) into v_found from (select 1 from public.freelancer_invoices i where i.id = any(v_ids) order by i.id for update) x;
 if v_found <> cardinality(v_ids) then raise exception using errcode = 'P0404', message = 'Invoice not found'; end if;
 if exists (select 1 from public.freelancer_invoices i where i.id = any(v_ids) and (i.paid_at is not null or i.paid_by_transaction_id is not null or i.review = 'rejected')) then
  raise exception using errcode = 'P0409', message = 'An invoice is already paid or rejected';
 end if;
 if exists (select 1 from public.freelancer_invoices i where i.paid_by_transaction_id = transaction_id and not (i.id = any(v_ids)))
   or exists (select 1 from public.freelancer_invoice_matches m where m.transaction_id = freelancer_invoice_mark_paid.transaction_id and m.state = 'confirmed' and not (m.invoice_id = any(v_ids))) then
  raise exception using errcode = 'P0409', message = 'This debit already pays another invoice';
 end if;

 update public.freelancer_invoices i
    set paid_at = freelancer_invoice_mark_paid.paid_at, paid_by_transaction_id = freelancer_invoice_mark_paid.transaction_id,
        version = i.version + 1, updated_at = now()
  where i.id = any(v_ids);
 insert into public.freelancer_invoice_matches(invoice_id, transaction_id, kind, state, decided_by)
 select x, freelancer_invoice_mark_paid.transaction_id, match_kind, 'confirmed', actor from unnest(v_ids) x
 on conflict on constraint freelancer_invoice_matches_pkey do update set kind = excluded.kind, state = 'confirmed', decided_by = excluded.decided_by;
 insert into public.freelancer_invoice_events(invoice_id, kind, actor_email, detail)
 select x, v_event, actor, jsonb_build_object('transactionId', freelancer_invoice_mark_paid.transaction_id, 'paidAt', freelancer_invoice_mark_paid.paid_at, 'invoiceIds', to_jsonb(v_ids))
   from unnest(v_ids) x;
 return cardinality(v_ids);
end;
$$;
revoke all on function public.freelancer_invoice_mark_paid(uuid[], text, text, text, timestamptz) from public, anon;
grant execute on function public.freelancer_invoice_mark_paid(uuid[], text, text, text, timestamptz) to authenticated, service_role;

-- Freelancers send invoices through their own portal tab, not as plain documents.
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
   where 'person' = any(t.owner_kinds) and t.code not in ('PAYSLIP', 'FREELANCE_INVOICE');

notify pgrst, 'reload schema';
