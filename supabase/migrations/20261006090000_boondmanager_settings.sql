-- BoondManager integration (Settings → Import from BoondManager). Holds the
-- encrypted connection credentials used by apps/admin/api/boondmanager.ts to
-- pull clients (companies) and employees (resources) into the sales and HR
-- tables. Credentials are AES-256-GCM encrypted by the API layer with a
-- server-side key — the database only ever stores ciphertext, same envelope
-- as ai_settings.
create table public.boondmanager_settings (
  id text primary key,
  encrypted_credentials text not null,
  updated_at timestamptz not null default now()
);
alter table public.boondmanager_settings enable row level security;

-- Admin-managed like the rest of the operations tables; reading the ciphertext
-- is harmless because only the API (holding the encryption key) can decrypt.
create policy boondmanager_settings_admin on public.boondmanager_settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
