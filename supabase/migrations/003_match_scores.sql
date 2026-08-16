-- Persisted once a match is confirmed FINISHED by settle-results, so
-- settlement is a pure function of local data with no re-fetch needed, and
-- there's a durable audit trail of what score a settlement decision was
-- based on. matches.status has no check constraint (verified in
-- 001_initial_schema.sql), so it can start receiving 'finished' /
-- 'postponed' / 'cancelled' values with no migration risk there.

alter table matches
  add column if not exists home_score integer,
  add column if not exists away_score integer;
