-- First administrator explicitly approved by the project owner.
-- Resolve the confirmed account by email; never grant roles from user metadata.
update public.user_roles set role = 'admin'
where user_id = (
  select id from auth.users
  where lower(email) = 'jermiah@quicksort.fr'
    and email_confirmed_at is not null
);
