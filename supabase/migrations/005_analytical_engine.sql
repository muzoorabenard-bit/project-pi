-- Phase 2 analytical engine schema. Pure additions — no existing table is
-- altered or dropped. `analyze-matches`'s current single-pick flow (writing
-- to `recommendations`/`recommended_bets`) is untouched and keeps running
-- exactly as before; these tables are written only by the new engine/cli
-- scripts, for review and backtesting, not yet wired into production.

create table if not exists leagues (
  id      text primary key,   -- 'PL','PD','SA','BL1','FL1' (football-data.org codes)
  name    text not null,
  country text not null
);

create table if not exists teams (
  id        integer primary key,  -- football-data.org team id
  name      text not null,
  league_id text references leagues(id)
);

-- One row per prediction run per match — the exact feature payload used, so
-- a prediction is reproducible without re-deriving it from team_stats as it
-- stood at some later, mutated point in time.
create table if not exists feature_snapshots (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id),
  model_version text not null,
  captured_at   timestamptz not null default now(),
  features      jsonb not null
);
create index if not exists feature_snapshots_match_id_idx on feature_snapshots (match_id);

-- One row PER CANDIDATE MARKET per match — this is what makes ranking
-- possible. Never just the winning market.
create table if not exists predictions (
  id                    uuid primary key default gen_random_uuid(),
  match_id              uuid not null references matches(id),
  feature_snapshot_id   uuid references feature_snapshots(id),
  model_version         text not null,
  market                text not null,
  selection             text not null,
  model_probability     numeric not null check (model_probability >= 0 and model_probability <= 1),
  implied_probability   numeric check (implied_probability is null or (implied_probability >= 0 and implied_probability <= 1)),
  bookmaker_odds        numeric,
  odds_source           text,
  odds_captured_at      timestamptz,
  edge                  numeric,
  ev                    numeric,
  confidence            numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  data_quality          text not null check (data_quality in ('HIGH','MEDIUM','LOW','INSUFFICIENT')),
  market_rank           integer not null,
  created_at            timestamptz not null default now()
);
create index if not exists predictions_match_id_idx on predictions (match_id);
create index if not exists predictions_match_rank_idx on predictions (match_id, market_rank);

-- Separate from predictions: this is what the betting engine DECIDED, not
-- what it merely priced.
create table if not exists betting_decisions (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id),
  prediction_id uuid references predictions(id),  -- null when decision = NO_EDGE
  decision      text not null check (decision in ('VALUE_BET','NO_EDGE','COVERAGE_BET')),
  reason        text not null,
  model_version text not null,
  created_at    timestamptz not null default now()
);
create index if not exists betting_decisions_match_id_idx on betting_decisions (match_id);

create table if not exists model_versions (
  version     text primary key,
  description text not null,
  config      jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  details     jsonb
);
