-- Run in Supabase SQL Editor after enabling pg_cron and pg_net extensions
-- (already enabled — see 002_cron_schedule.sql for the existing fetch job).

select cron.schedule(
  'project-pi-hourly-settle',
  '0 * * * *',
  $$
    select net.http_post(
      url     := 'https://vkaprrhkmbbhagcidaka.supabase.co/functions/v1/settle-results',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrYXBycmhrbWJiaGFnY2lkYWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MzI1OTQsImV4cCI6MjA5MjQwODU5NH0.mwO_T3In25ajMXVZVHtkB1tiXAZlQBe3VQ9hkq0F3XM", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
