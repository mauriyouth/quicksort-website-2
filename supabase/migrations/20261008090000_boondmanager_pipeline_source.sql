-- BoondManager integration (Settings → Import from BoondManager): the
-- employees import stamps imported rows with source 'boondmanager', which the
-- original check constraint on pipeline_candidates.source rejected — every
-- insert/update failed with a constraint violation. Re-create the constraint
-- with 'boondmanager' allowed, keeping every previously accepted value.
alter table public.pipeline_candidates drop constraint if exists pipeline_candidates_source_check;

alter table public.pipeline_candidates add constraint pipeline_candidates_source_check
  check (source in (
    'career_site', 'linkedin', 'referral', 'job_board', 'spontaneous',
    'rediscovery', 'boondmanager', 'other'
  ));
