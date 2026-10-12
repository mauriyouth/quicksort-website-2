-- The maps_to grouping on admin_types was never read by any screen or report;
-- types are picked by key straight from the administration panel.
alter table public.admin_types drop column if exists maps_to;
