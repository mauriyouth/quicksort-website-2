-- Repair: the remote database was provisioned with an earlier revision of
-- 20261001090000_sales_pipeline.sql that created public.sales_people; the
-- codebase standardized on public.sales_contacts. Rename in place so the
-- schema matches the code, preserving existing rows and FK wiring (the FKs
-- on sales_sponsors.person_id and sales_activities.person_id follow the
-- table rename automatically).
do $$
begin
  if to_regclass('public.sales_people') is not null and to_regclass('public.sales_contacts') is null then
alter table public.sales_people rename to sales_contacts;

alter table public.sales_contacts rename constraint sales_people_pkey to sales_contacts_pkey;
alter table public.sales_contacts rename constraint sales_people_client_id_fkey to sales_contacts_client_id_fkey;
alter table public.sales_contacts rename constraint sales_people_email_check to sales_contacts_email_check;
alter table public.sales_contacts rename constraint sales_people_linkedin_check to sales_contacts_linkedin_check;
alter table public.sales_contacts rename constraint sales_people_name_check to sales_contacts_name_check;
alter table public.sales_contacts rename constraint sales_people_notes_check to sales_contacts_notes_check;
alter table public.sales_contacts rename constraint sales_people_phone_check to sales_contacts_phone_check;
alter table public.sales_contacts rename constraint sales_people_role_check to sales_contacts_role_check;

alter index public.sales_people_client_idx rename to sales_contacts_client_idx;
alter index public.sales_people_email_idx rename to sales_contacts_email_idx;

alter policy sales_people_admin on public.sales_contacts rename to sales_contacts_admin;

  end if;
end;
$$;
