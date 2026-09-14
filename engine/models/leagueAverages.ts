// The missing piece behind the Inter-vs-Udinese miscalibration: the old
// poisson.ts used a single hardcoded LEAGUE_AVG_GOALS=1.4 for every league,
// and computed expected goals directly from two teams' raw per-game
// averages with no notion of "goals scored against a normal opponent" vs
// "goals scored against this specific opponent's actual defensive
// strength." A team's raw average doesn't know whether it was racked up
// against strong or weak defenses — attack/defense STRENGTH (this team's
// average relative to the league's average) is what a real Poisson model
// needs, computed from every team_stats row available for that specific
// league, not a global constant.

export interface LeagueAverages {
  avgGoalsScoredPerTeam: number;
  avgGoalsConcededPerTeam: number;
  sampleSize: number; // how many teams' data went into this average
}

// Used only when a league has zero team_stats coverage yet (brand new
// league, or fetch-fixtures hasn't run for it) — the same 1.4 the old
// hardcoded constant used, kept as an explicit, documented last resort
// rather than silently defaulting to 0 (which would divide-by-zero downstream).
export const FALLBACK_LEAGUE_AVERAGES: LeagueAverages = {
  avgGoalsScoredPerTeam: 1.4,
  avgGoalsConcededPerTeam: 1.4,
  sampleSize: 0,
};

export interface TeamAverageRow {
  goalsScoredAvg: number | null;
  goalsConcededAvg: number | null;
}

/** Pure. Averages over whatever teams in this league actually have data —
 * a partial-league sample (only teams appearing in upcoming fixtures get
 * refreshed by fetch-fixtures) is still far more honest than a fixed
 * cross-league constant, since it at least reflects this league's real
 * scoring environment (e.g. Bundesliga's higher-scoring games vs Serie A's
 * lower-scoring ones). */
export function computeLeagueAverages(rows: TeamAverageRow[]): LeagueAverages {
  const scored = rows.map((r) => r.goalsScoredAvg).filter((v): v is number => v !== null);
  const conceded = rows.map((r) => r.goalsConcededAvg).filter((v): v is number => v !== null);

  if (scored.length === 0 || conceded.length === 0) {
    return FALLBACK_LEAGUE_AVERAGES;
  }

  return {
    avgGoalsScoredPerTeam: +(scored.reduce((s, v) => s + v, 0) / scored.length).toFixed(4),
    avgGoalsConcededPerTeam: +(conceded.reduce((s, v) => s + v, 0) / conceded.length).toFixed(4),
    sampleSize: Math.min(scored.length, conceded.length),
  };
}

/** >1 means this team scores more than a league-average team; <1 means less. */
export function attackStrength(teamGoalsScoredAvg: number, league: LeagueAverages): number {
  return league.avgGoalsScoredPerTeam > 0 ? teamGoalsScoredAvg / league.avgGoalsScoredPerTeam : 1;
}

/** >1 means this team concedes more than a league-average team (weaker
 * defense); <1 means it concedes less (stronger defense). */
export function defenseStrength(teamGoalsConcededAvg: number, league: LeagueAverages): number {
  return league.avgGoalsConcededPerTeam > 0 ? teamGoalsConcededAvg / league.avgGoalsConcededPerTeam : 1;
}
