-- Every real "why didn't picks/bets happen today" investigation this project
-- has hit (analyze-matches cron missing entirely after the DB rebuild,
-- fetch-fixtures cron left pointing at the old dead project, a hardcoded
-- dry_run:true, today's Supabase pg_net DNS/timeout flakiness) shared one
-- root pattern: the failure was completely silent. Nothing ever alerted
-- anyone — it was only ever discovered hours or days later because someone
-- asked "why didn't this run?". This table plus pipeline-healthcheck (see
-- that function + this migration's cron.schedule below) closes that gap:
-- fetch-fixtures and analyze-matches now record a heartbeat on every
-- invocation (success or failure), and a daily healthcheck alerts on
-- Telegram the same day if either one has gone stale — turning a silent,
-- multi-day-old break into a same-day page.
create table if not exists pipeline_heartbeats (
  function_name text primary key,
  last_run_at   timestamptz not null,
  ok            boolean not null,
  detail        text
);

select cron.schedule(
  'project-pi-pipeline-healthcheck',
  '0 9 * * *',
  $$
    select net.http_post(
      url     := 'https://vkaprrhkmbbhagcidaka.supabase.co/functions/v1/pipeline-healthcheck',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrYXBycmhrbWJiaGFnY2lkYWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MzI1OTQsImV4cCI6MjA5MjQwODU5NH0.mwO_T3In25ajMXVZVHtkB1tiXAZlQBe3VQ9hkq0F3XM", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
