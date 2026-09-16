-- ROOT CAUSE, finally: every cron job in this project (002, 004, 008, 010)
-- has been calling `vkaprrhkmbbhagcidaka.supabase.co` — a project this
-- Supabase account does NOT own or have management access to (`supabase
-- projects list` shows only `dmjywulepjrwptjsilgl`, named "gadf"; `supabase
-- link --project-ref vkaprrhkmbbhagcidaka` fails outright with "Resource has
-- been removed"). That hostname happened to still resolve and serve
-- responses some of the time — explaining 2026-09-16's whole "intermittent
-- DNS failure" saga — but it was never the right target.
--
-- Separately and just as importantly: fetch-fixtures can legitimately take
-- well over pg_net's default 5-second timeout to finish a real run (it
-- deliberately rate-limits itself with a 7-second delay between EACH
-- football-data.org call — 5 competitions for standings alone is 35s before
-- even starting the per-team stats loop). Confirmed live: a manual call with
-- a 25s client-side timeout still reported "timeout" to us, yet the function
-- kept running server-side and successfully wrote today's fixtures ~19s
-- after our client gave up. Supabase Edge Functions do not appear to abort
-- on caller disconnect, so this was never actually breaking production
-- runs — but it did make `net._http_response` an unreliable signal of
-- whether a run truly succeeded, which is exactly what sent today's
-- diagnosis in circles. Every job below now uses `dmjywulepjrwptjsilgl` (the
-- real, account-owned project) and a generous timeout so a genuine failure
-- and a slow-but-successful run are no longer indistinguishable.
select cron.schedule(
  'project-pi-daily-fetch',
  '0 5 * * *',
  $$
    select net.http_post(
      url     := 'https://dmjywulepjrwptjsilgl.supabase.co/functions/v1/fetch-fixtures',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtanl3dWxlcGpyd3B0anNpbGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDg5ODcsImV4cCI6MjEwNDUyNDk4N30.BX5Jp33sgxyDVkHLonfqTeYN9wPoBunQcoiuh4G5vg8", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
  $$
);

-- Backup only — fetch-fixtures already chains directly into analyze-matches
-- (fire-and-forget) as its own step 7. This 5-minute-later tick exists purely
-- in case that in-process chain call itself never landed.
select cron.schedule(
  'project-pi-daily-analyze',
  '5 5 * * *',
  $$
    select net.http_post(
      url     := 'https://dmjywulepjrwptjsilgl.supabase.co/functions/v1/analyze-matches',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtanl3dWxlcGpyd3B0anNpbGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDg5ODcsImV4cCI6MjEwNDUyNDk4N30.BX5Jp33sgxyDVkHLonfqTeYN9wPoBunQcoiuh4G5vg8", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
  $$
);

select cron.schedule(
  'project-pi-hourly-settle',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://dmjywulepjrwptjsilgl.supabase.co/functions/v1/settle-results',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtanl3dWxlcGpyd3B0anNpbGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDg5ODcsImV4cCI6MjEwNDUyNDk4N30.BX5Jp33sgxyDVkHLonfqTeYN9wPoBunQcoiuh4G5vg8", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

select cron.schedule(
  'project-pi-pipeline-healthcheck',
  '0 9 * * *',
  $$
    select net.http_post(
      url     := 'https://dmjywulepjrwptjsilgl.supabase.co/functions/v1/pipeline-healthcheck',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtanl3dWxlcGpyd3B0anNpbGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDg5ODcsImV4cCI6MjEwNDUyNDk4N30.BX5Jp33sgxyDVkHLonfqTeYN9wPoBunQcoiuh4G5vg8", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);
