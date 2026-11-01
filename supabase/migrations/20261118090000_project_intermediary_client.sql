-- Optional intermediary on delivery projects. A project always has a main
-- client (the end customer the work is for); when an intermediary is set,
-- invoices go to the intermediary instead of the main client. NULL means
-- the main client is billed directly.
alter table public.sales_projects
  add column intermediary_client_id uuid references public.sales_clients(id) on delete set null;

-- The intermediary is a third party, never the client itself.
alter table public.sales_projects
  add constraint sales_projects_intermediary_chk
  check (intermediary_client_id is null or intermediary_client_id <> client_id);
