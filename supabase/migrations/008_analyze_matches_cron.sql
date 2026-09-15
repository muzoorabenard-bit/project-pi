-- Run in Supabase SQL Editor (or `supabase db push`) after enabling pg_cron
-- and pg_net extensions (already enabled — see 002_cron_schedule.sql).
--
-- 2026-09-15: analyze-matches never had a committed cron migration — its
-- schedule was originally set up ad-hoc in Supabase Studio on the old
-- project (vkaprrhkmbbhagcidaka) and was never recreated after the backend
-- moved to the current shared "gadf" project (dmjywulepjrwptjsilgl). Result:
-- fetch-fixtures and settle-results kept running, but recommendations and
-- recommended_bets stayed at zero rows indefinitely with nothing to show it
-- was missing. 05:05 UTC — 5 minutes after fetch-fixtures' 05:00 UTC cron,
-- 15 minutes before ai-bet-ug's resolve-events at 05:20 UTC.

select cron.schedule(
  'project-pi-daily-analyze',
  '5 5 * * *',
  $$
    select net.http_post(
      url     := 'https://dmjywulepjrwptjsilgl.supabase.co/functions/v1/analyze-matches',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtanl3dWxlcGpyd3B0anNpbGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDg5ODcsImV4cCI6MjEwNDUyNDk4N30.BX5Jp33sgxyDVkHLonfqTeYN9wPoBunQcoiuh4G5vg8", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
