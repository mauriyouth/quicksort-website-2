-- Browser uploads to candidate-documents use `${session.user.id}` as the
-- self-folder prefix (resume intake, CV analyzer). For Clerk sessions that id is
-- the Clerk user id (JWT `sub`), while the self-folder policies only accepted the
-- shadow auth user uuid from the `user_metadata.user_id` claim — so every Clerk
-- upload was denied with "new row violates row-level security policy". Accept
-- either verified claim; both stay self-scoped, and for email/password sessions
-- the two values are identical so nothing changes there.

create or replace function private.request_subject() returns text
language sql stable
set search_path = '' as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
$$;
revoke all on function private.request_subject() from public;
grant execute on function private.request_subject() to authenticated, anon;

drop policy onboarding_storage_read on storage.objects;
create policy onboarding_storage_read on storage.objects for select to authenticated
using (bucket_id = 'candidate-documents' and ((storage.foldername(name))[1] in ((select private.workspace_user_id())::text, (select private.request_subject())) or (select private.is_admin())));

drop policy onboarding_storage_insert on storage.objects;
create policy onboarding_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] in ((select private.workspace_user_id())::text, (select private.request_subject())));

drop policy onboarding_storage_delete on storage.objects;
create policy onboarding_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] in ((select private.workspace_user_id())::text, (select private.request_subject())));
