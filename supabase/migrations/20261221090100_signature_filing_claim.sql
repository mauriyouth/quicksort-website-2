-- Completion filing (webhook or Refresh) claims the request first, so two
-- concurrent completions never file the signed PDF twice. A claim older than
-- five minutes is treated as abandoned (a crashed function) and can be taken over.
alter table public.signature_requests add column filing_claimed_at timestamptz;

notify pgrst, 'reload schema';
