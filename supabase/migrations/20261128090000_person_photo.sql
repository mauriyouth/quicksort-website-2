-- Person photo: a portrait filed like any other person document (Drive,
-- 01_Identite), shown in place of the initials on the person page. Not
-- sensitive and never required; the newest active one is the photo.
insert into public.document_types
  (code, label, owner_kinds, folder, requires_expiry, default_validity_months, warn_days, sensitive, required_for, requirement_group, position)
values
  ('PHOTO', 'Photo', '{person}', 'identite', false, null, '{}', false, '{}', null, 5)
on conflict (code) do nothing;
