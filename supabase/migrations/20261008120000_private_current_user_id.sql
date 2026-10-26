-- candidate capability tables default candidate_id to the signed-in user via
-- private.current_user_id(). That helper ships with some Supabase setups but
-- not hosted projects, so define it here (idempotent) as the Clerk/Supabase
-- identity: auth.uid() resolved from the request JWT.
create or replace function private.current_user_id() returns uuid
language sql stable as $$
  select auth.uid()
$$;
