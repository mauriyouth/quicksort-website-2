-- Operations board: free-form content (notes, specs, links) on cards,
-- edited from the card editor in the admin UI. Empty by default.

alter table public.ops_cards
  add column content text not null default '' check (length(content) <= 20000);
