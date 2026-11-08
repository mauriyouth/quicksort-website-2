-- BoondManager integration removed (Settings → Import from BoondManager and
-- /api/boondmanager are gone). Drop the table that held its encrypted
-- connection credentials. The 'boondmanager' value stays allowed in
-- pipeline_candidates.source so previously imported rows remain valid.
drop table if exists public.boondmanager_settings;
