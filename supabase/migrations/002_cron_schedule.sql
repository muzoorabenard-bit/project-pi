-- Run in Supabase SQL Editor after enabling pg_cron and pg_net extensions.

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
