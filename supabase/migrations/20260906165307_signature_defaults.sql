alter table public.contract_signatures alter column candidate_id set default auth.uid();
alter table public.contract_signatures alter column document_sha256 set default '';
