-- 2026-09-15: fetch-fixtures already pulls each team's standings row from
-- football-data.org but discarded playedGames, so analyze-matches had no
-- way to tell "6 points after 2 games" apart from "6 points after 20
-- games" — classifyMotivation()/drawTrapFlags() treated both identically,
-- calling teams a few games into the season "in a relegation fight" or
-- "fighting for the title" off standings noise. This column lets those
-- classifiers gate on season progress instead.
alter table team_stats
  add column if not exists games_played integer;
