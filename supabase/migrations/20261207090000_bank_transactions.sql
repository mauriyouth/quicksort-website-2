-- Qonto bank transactions (debits) synced into Supabase, classified by an LLM
-- into business-plan fixed-charge lines, with an optional manual override.
do $$
begin
 if not exists (
  select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'fixed_charge_line'
 ) then
  create type public.fixed_charge_line as enum (
   'loyer', 'outils', 'marketing', 'honoraires', 'divers', 'hors_charges_fixes'
  );
 end if;
end $$;

create table if not exists public.bank_transactions (
 id text primary key,
 settled_at timestamptz,
 emitted_at timestamptz,
 month date not null,
 amount_cents bigint not null,
 vat_cents bigint not null default 0,
 amount_ht_cents bigint not null,
 currency text not null default 'EUR',
 label text not null default '',
 counterparty text not null default '',
 operation_type text not null default '',
 qonto_category text,
 note text,
 reference text,
 status text not null,
 qonto_updated_at timestamptz not null,
 raw jsonb not null,
 ai_line public.fixed_charge_line,
 ai_confidence numeric(4,3),
 ai_model text,
 ai_classified_at timestamptz,
 manual_line public.fixed_charge_line,
 manual_by text,
 manual_at timestamptz
);

create index if not exists bank_transactions_month_idx
 on public.bank_transactions (month);
create index if not exists bank_transactions_unclassified_idx
 on public.bank_transactions (id) where ai_line is null and manual_line is null;

create table if not exists public.bank_sync_state (
 id text primary key,
 cursor timestamptz,
 coverage_start date,
 backfill_done boolean not null default false,
 locked_until timestamptz,
 last_run_at timestamptz,
 last_error text
);

-- needs_review: the 0.7 threshold mirrors REVIEW_THRESHOLD in
-- apps/admin/server/bank/classifier.ts — keep both in sync.
create or replace view public.bank_transactions_effective
 with (security_invoker = true) as
select
 t.*,
 coalesce(t.manual_line, t.ai_line) as line,
 (t.manual_line is null and t.ai_confidence < 0.7) as needs_review
from public.bank_transactions t;

alter table public.bank_transactions enable row level security;
drop policy if exists bank_transactions_admin on public.bank_transactions;
create policy bank_transactions_admin on public.bank_transactions for all to authenticated
 using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.bank_sync_state enable row level security;
drop policy if exists bank_sync_state_admin on public.bank_sync_state;
create policy bank_sync_state_admin on public.bank_sync_state for all to authenticated
 using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.bank_transactions from anon;
revoke all on public.bank_sync_state from anon;
revoke all on public.bank_transactions_effective from anon;
grant select, insert, update, delete on public.bank_transactions to authenticated;
grant select, insert, update, delete on public.bank_sync_state to authenticated;
grant select on public.bank_transactions_effective to authenticated;
