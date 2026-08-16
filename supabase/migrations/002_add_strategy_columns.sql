-- Add enhanced strategy columns to team_stats
alter table team_stats
  add column if not exists home_wins_last6        integer,
  add column if not exists home_draws_last6       integer,
  add column if not exists home_losses_last6      integer,
  add column if not exists home_unbeaten_streak   integer,
  add column if not exists home_goals_scored_avg  numeric,
  add column if not exists home_goals_conceded_avg numeric,
  add column if not exists away_wins_last6        integer,
  add column if not exists away_goals_scored_avg  numeric,
  add column if not exists away_goals_conceded_avg numeric,
  add column if not exists clean_sheets_last10    integer,
  add column if not exists league_position        integer,
  add column if not exists league_points          integer,
  add column if not exists gap_to_relegation      integer,
  add column if not exists gap_to_top4            integer,
  add column if not exists total_teams            integer;
