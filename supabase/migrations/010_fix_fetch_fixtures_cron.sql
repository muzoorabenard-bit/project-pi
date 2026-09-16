-- project-pi-daily-fetch (jobid 1, from 002_cron_schedule.sql) was still
-- pointing at the OLD pre-rebuild Supabase project host
-- (dmjywulepjrwptjsilgl.supabase.co) with no Authorization header at all —
-- the same "leftover from before the project was rebuilt" issue already
-- found and fixed for analyze-matches in 008_analyze_matches_cron.sql, but
-- fetch-fixtures itself was missed at the time.
--
-- Effect: every 05:00 UTC run 401'd (net._http_response confirms
-- "UNAUTHORIZED_NO_AUTH_HEADER" against the wrong host), so no new fixtures
-- have ever been fetched automatically since the rebuild — every match
-- currently in `matches` (8 rows, all 2026-09-14/15) came from manual
-- triggers during the previous session, not the cron. This is why no picks
-- exist for 2026-09-16: fetch-fixtures never ran, so analyze-matches had
-- nothing to analyze ({"ok":true,"message":"No fixtures to analyze"}).
--
-- cron.schedule() with an existing job name replaces that job's definition
-- in place (same pattern used to originally fix analyze-matches).
select cron.schedule(
  'project-pi-daily-fetch',
  '0 5 * * *',
  $$
    select net.http_post(
      url     := 'https://vkaprrhkmbbhagcidaka.supabase.co/functions/v1/fetch-fixtures',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrYXBycmhrbWJiaGFnY2lkYWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MzI1OTQsImV4cCI6MjA5MjQwODU5NH0.mwO_T3In25ajMXVZVHtkB1tiXAZlQBe3VQ9hkq0F3XM", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
