-- Google Drive contract storage (Sales → Projects → Contract). Projects keep
-- their contract (and annexes) in one Drive folder per contract, under a
-- shared root folder (default "Contrats_Clients"), named "<Client>/<Contract>"
-- like the existing manual organization. The google_drive_settings table
-- holds the encrypted service-account key used by apps/admin/api/google-drive.ts
-- to call the Drive API server-side — the database only ever stores
-- ciphertext, same envelope as ai_settings / boondmanager_settings.
create table public.google_drive_settings (
  id text primary key,
  encrypted_credentials text not null,
  updated_at timestamptz not null default now()
);
alter table public.google_drive_settings enable row level security;

-- Admin-managed like the rest of the operations tables; reading the
-- ciphertext is harmless because only the API (holding the encryption key)
-- can decrypt.
create policy google_drive_settings_admin on public.google_drive_settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- One contract folder per project. The columns are a cache of the Drive
-- folder created (or matched) for the project; the files themselves live in
-- Google Drive, never in the database.
alter table public.sales_projects
  add column drive_folder_id text,
  add column drive_folder_name text,
  add column drive_folder_link text;
