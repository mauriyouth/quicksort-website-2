-- The Clerk bridge functions run with definer rights; anon must not execute them.
-- (Supabase default privileges grant EXECUTE to anon on new functions.)
revoke execute on function public.sync_clerk_profile() from anon;
revoke execute on function public.review_admin_access(text, text) from anon;
