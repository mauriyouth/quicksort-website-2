create or replace view public.my_application as
select c.id, c.full_name, c.stage, c.start_date, c.created_at, c.updated_at
from public.pipeline_candidates c
where c.email = (select p.email from public.profiles p where p.id = (select auth.uid()));
