-- Backfill the referential defaults when the tables are empty. The original
-- seed (20261007090000) never landed in every environment, leaving
-- admin_statuses/admin_types empty; the app then silently served its built-in
-- hardcoded defaults, so the "Global settings" screen and every picker showed
-- phantom values that could not be edited (no rows to update). Idempotent:
-- only inserts when the table has no rows at all, never overwrites user data.
insert into public.admin_statuses (kind, key, label, color, position, is_default, is_terminal, visible)
select v.kind, v.key, v.label, v.color, v.position, v.is_default, v.is_terminal, v.visible
from (values
  ('project',     'en_cours',    'En cours',        '#3b82f6', 0, true,  false, true),
  ('project',     'archive',     'Archivé',         '#475569', 1, false, true,  true),
  ('opportunity', 'lead',        'Piste identifiée', '#f59e0b', 0, true,  false, true),
  ('opportunity', 'qualified',   'Qualifié',        '#3b82f6', 1, false, false, true),
  ('opportunity', 'meeting',     'Rendez-vous',     '#8b5cf6', 2, false, false, true),
  ('opportunity', 'proposal',    'Proposition',     '#f59e0b', 3, false, false, true),
  ('opportunity', 'negotiation', 'Négociation',     '#f97316', 4, false, false, true),
  ('opportunity', 'won',         'Gagné',           '#16a34a', 5, false, true,  true),
  ('opportunity', 'lost',        'Perdu',           '#dc2626', 6, false, true,  true),
  ('resource',    'candidate',   'Candidat',        '#f59e0b', 0, true,  false, true),
  ('resource',    'employee',    'En mission',      '#16a34a', 1, false, false, true),
  ('resource',    'alumni',      'Sortie',          '#475569', 2, false, true,  true)
) as v(kind, key, label, color, position, is_default, is_terminal, visible)
where not exists (select 1 from public.admin_statuses);

insert into public.admin_types (key, label, mode, position, visible)
select v.key, v.label, v.mode, v.position, v.visible
from (values
  ('regie',       'Régie',       'regie',       0, true),
  ('forfait',     'Forfait',     'forfait',     1, true),
  ('recrutement', 'Recrutement', 'recrutement', 2, true),
  ('produit',     'Produit',     'produit',     3, true)
) as v(key, label, mode, position, visible)
where not exists (select 1 from public.admin_types);
