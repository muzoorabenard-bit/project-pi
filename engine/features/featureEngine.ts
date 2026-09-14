import type { ContextStats, FormStats, HomeAwayStats, TeamFeatures } from "../types.js";

// Mirrors project-pi's existing `team_stats` table exactly (see
// supabase/migrations/001_initial_schema.sql + 002_add_strategy_columns.sql).
// Kept as a plain row shape rather than importing a Supabase-generated type
// so this module has zero DB dependency and stays pure/unit-testable.
export interface TeamStatsRow {
  team_name: string;
  form: string | null;
  goals_scored_avg: number | null;
  goals_conceded_avg: number | null;
  btts_rate: number | null;
  over25_rate: number | null;
  clean_sheets_last10: number | null;
  home_wins_last6: number | null;
  home_draws_last6: number | null;
  home_losses_last6: number | null;
  home_unbeaten_streak: number | null;
  home_goals_scored_avg: number | null;
  home_goals_conceded_avg: number | null;
  away_wins_last6: number | null;
  away_goals_scored_avg: number | null;
  away_goals_conceded_avg: number | null;
  league_position: number | null;
  league_points: number | null;
  gap_to_relegation: number | null;
  gap_to_top4: number | null;
  total_teams: number | null;
}

function parseForm(form: string | null): { played: number; wins: number; draws: number; losses: number } {
  if (!form) return { played: 0, wins: 0, draws: 0, losses: 0 };
  let wins = 0, draws = 0, losses = 0;
  for (const ch of form.toUpperCase()) {
    if (ch === "W") wins++;
    else if (ch === "D") draws++;
    else if (ch === "L") losses++;
  }
  return { played: wins + draws + losses, wins, draws, losses };
}

/** Pure — no invented values. Anything not present in `row` stays null. */
export function buildFormStats(row: TeamStatsRow, asOf: string): FormStats {
  const { played, wins, draws, losses } = parseForm(row.form);
  return {
    asOf,
    played,
    wins,
    draws,
    losses,
    goalsScoredAvg: row.goals_scored_avg,
    goalsConcededAvg: row.goals_conceded_avg,
    bttsRate: row.btts_rate,
    over15Rate: null, // not captured by fetch-fixtures today — never approximated from over25Rate
    over25Rate: row.over25_rate,
    under25Rate: row.over25_rate !== null ? +(1 - row.over25_rate).toFixed(4) : null,
    cleanSheets: row.clean_sheets_last10,
    failedToScore: null, // not captured today
  };
}

export function buildHomeStats(row: TeamStatsRow, asOf: string): HomeAwayStats {
  return {
    asOf,
    wins: row.home_wins_last6,
    draws: row.home_draws_last6,
    losses: row.home_losses_last6,
    goalsScoredAvg: row.home_goals_scored_avg,
    goalsConcededAvg: row.home_goals_conceded_avg,
    cleanSheetStreak: null, // not tracked separately from clean_sheets_last10 today
    unbeatenStreak: row.home_unbeaten_streak,
  };
}

export function buildAwayStats(row: TeamStatsRow, asOf: string): HomeAwayStats {
  return {
    asOf,
    wins: row.away_wins_last6,
    draws: null, // not captured by fetch-fixtures today
    losses: null,
    goalsScoredAvg: row.away_goals_scored_avg,
    goalsConcededAvg: row.away_goals_conceded_avg,
    cleanSheetStreak: null,
    unbeatenStreak: null, // no away-side equivalent captured today
  };
}

export function buildContextStats(row: TeamStatsRow, asOf: string): ContextStats {
  return {
    asOf,
    leaguePosition: row.league_position,
    leaguePoints: row.league_points,
    totalTeams: row.total_teams,
    gapToRelegation: row.gap_to_relegation,
    gapToTop4: row.gap_to_top4,
    restDays: null, // requires fixture-history lookback not yet fetched — see context.ts
    fixtureCongestion: null,
  };
}

/**
 * Builds the full TeamFeatures for one team. `isHome` controls which side's
 * home/away split is populated — the other side is explicitly null rather
 * than filled with irrelevant data (Section 5's "home statistics for the
 * home team and away statistics for the away team").
 */
export function buildTeamFeatures(row: TeamStatsRow, asOf: string, isHome: boolean): TeamFeatures {
  return {
    team: row.team_name,
    overall: buildFormStats(row, asOf),
    home: isHome ? buildHomeStats(row, asOf) : null,
    away: isHome ? null : buildAwayStats(row, asOf),
    context: buildContextStats(row, asOf),
  };
}

/** A neutral fallback for a team with no team_stats row at all yet — every
 * field is explicitly null/zero rather than a guessed league-average, so
 * downstream data-quality scoring can see it's missing (see dataQuality.ts). */
export function emptyTeamStatsRow(teamName: string): TeamStatsRow {
  return {
    team_name: teamName,
    form: null,
    goals_scored_avg: null,
    goals_conceded_avg: null,
    btts_rate: null,
    over25_rate: null,
    clean_sheets_last10: null,
    home_wins_last6: null,
    home_draws_last6: null,
    home_losses_last6: null,
    home_unbeaten_streak: null,
    home_goals_scored_avg: null,
    home_goals_conceded_avg: null,
    away_wins_last6: null,
    away_goals_scored_avg: null,
    away_goals_conceded_avg: null,
    league_position: null,
    league_points: null,
    gap_to_relegation: null,
    gap_to_top4: null,
    total_teams: null,
  };
}
