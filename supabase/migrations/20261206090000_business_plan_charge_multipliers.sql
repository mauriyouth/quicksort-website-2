-- Business plan: employer-cost multipliers applied to gross salaries, one per
-- scenario, chosen from a dropdown on the Business plan page. The CJM
-- multiplier (×2) prices offers and already covers overheads that the plan
-- counts separately as fixed charges; the payroll actually paid runs at about
-- ×1.4 of gross (net + URSSAF + retraite + prévoyance + PAS, Qonto statement
-- of July 2026). Optimistic = real payroll ratio, pessimistic = CJM-like.
-- Edited from Global settings → Unit economics.

alter table public.hr_economics_settings
  add column if not exists bp_multiplier_optimistic numeric not null default 1.4
    check (bp_multiplier_optimistic > 0),
  add column if not exists bp_multiplier_pessimistic numeric not null default 2
    check (bp_multiplier_pessimistic > 0);
