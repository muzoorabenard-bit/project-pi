-- The only new table for the backtest/calibration framework. Deliberately
-- minimal (see BACKTEST_ASSESSMENT.md, section 7) — model-by-model outputs
-- are recomputed at analysis time from the already-immutable
-- feature_snapshots rows rather than duplicated into new tables, so this
-- just records that a report was generated and what it found, for
-- reproducibility (a report is regenerable from run parameters + the
-- data as of that time, but the full report text is preserved here so a
-- past run's exact findings are never lost to later data changes).

create table if not exists backtest_runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  model_version   text not null,
  config_version  text not null,
  start_date      date not null,
  end_date        date not null,
  league_filter   text,
  market_filter   text,
  report          jsonb not null
);
