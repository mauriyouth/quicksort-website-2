create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  event_date date not null,
  location text not null default 'Paris' check (char_length(trim(location)) between 1 and 160),
  event_url text not null unique check (event_url ~ '^https://luma\.com/[^[:space:]]+$'),
  banner_url text not null check (banner_url ~ '^https://(www\.quicksort\.fr/events/|kupbvrnjppcwqxmzxasi\.supabase\.co/storage/v1/object/public/event-banners/)[^[:space:]]+$'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert(title,event_date,location,event_url,banner_url,published), update(title,event_date,location,event_url,banner_url,published) on public.events to authenticated;
create policy events_public_read on public.events for select to anon, authenticated using (published);
create policy events_admin_read on public.events for select to authenticated using ((select private.is_admin()));
create policy events_admin_insert on public.events for insert to authenticated with check ((select private.is_admin()));
create policy events_admin_update on public.events for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create function private.events_updated_at() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;
revoke all on function private.events_updated_at() from public, anon, authenticated;
create trigger events_updated_at before update on public.events for each row execute function private.events_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-banners', 'event-banners', true, 5242880, array['image/jpeg','image/png','image/webp']);
create policy event_banners_read on storage.objects for select to anon, authenticated using (bucket_id = 'event-banners');
create policy event_banners_insert on storage.objects for insert to authenticated with check (bucket_id = 'event-banners' and (select private.is_admin()));
create policy event_banners_delete on storage.objects for delete to authenticated using (bucket_id = 'event-banners' and (select private.is_admin()));

insert into public.events (title,event_date,location,event_url,banner_url,published) values
('Cafe Compute Meetup: Paris','2026-09-30','Paris','https://luma.com/ccparis','https://www.quicksort.fr/events/cafe-compute-paris.jpg',true),
('Multimodal AI in Production (w/ The AI Collective)','2026-10-01','Paris','https://luma.com/quicksort-multimodal-ai','https://www.quicksort.fr/events/multimodal-ai.jpg',true);
