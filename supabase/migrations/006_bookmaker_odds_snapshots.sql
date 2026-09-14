-- Real, live-observed BetPawa odds — written by ai-bet-ug's new read-only
-- src/cli/captureOdds.ts (navigates + reads only, never clicks/places
-- anything). Kept in BetPawa's own market/selection vocabulary ("1X2"/"1",
-- "Double Chance"/"1X", etc. — same strings recommended_bets already uses)
-- rather than the engine's ApprovedMarket vocabulary — translation happens
-- in engine/odds/betpawaOddsAdapter.ts, keeping this table a plain, honest
-- record of what was actually on the page.

create table if not exists bookmaker_odds_snapshots (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references matches(id),
  source       text not null default 'betpawa',
  market       text not null,     -- 'Double Chance', 'BTTS', etc.
  selection    text not null,     -- '1X', 'Yes', 'Over 2.5', etc. — BetPawa's raw label
  odds         numeric not null,
  captured_at  timestamptz not null default now(),
  unique (match_id, source, market, selection)
);
create index if not exists bookmaker_odds_snapshots_match_id_idx on bookmaker_odds_snapshots (match_id);
