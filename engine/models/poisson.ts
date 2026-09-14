// Originally extracted from project-pi/supabase/functions/analyze-matches/
// index.ts. `expectedGoals` was rewritten (see leagueAverages.ts) after a
// live miscalibration was traced to it: computing xG straight from two
// teams' raw per-game averages divided by a hardcoded 1.4 has no notion of
// the QUALITY of opposition each average was earned against — a team
// conceding 1.67/game against a mix of average sides doesn't concede 1.67
// against an elite attack. Confirmed live 2026-09-14: BetPawa priced
// Udinese's away win at Inter at ~7% (odds 14.31); the raw-average version
// of this model put it at ~20%, agreeing suspiciously closely with two
// other independent models that also don't correct for opponent quality.
// Attack/defense STRENGTH (this team's average relative to its own
// league's average, not a cross-league constant) is the standard fix.

const MAX_GOALS_CONSIDERED = 8;

export function poissonPmf(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** Expected goals from strength coefficients (see leagueAverages.ts's
 * attackStrength/defenseStrength) rather than raw per-team averages —
 * `leagueAvgGoalsScored` re-centers the product back to real goals-per-game
 * units. A team with attackStrength=1.5 (50% more prolific than a
 * league-average side) facing a defenseStrength=0.7 opponent (30% stingier
 * than average) produces a higher xG than either raw average alone would
 * suggest, and correctly the reverse for a weak attack facing a strong defense. */
export function expectedGoals(teamAttackStrength: number, opponentDefenseStrength: number, leagueAvgGoalsScored: number): number {
  return leagueAvgGoalsScored * teamAttackStrength * opponentDefenseStrength;
}

export interface MatchResultProbabilities {
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** Full-grid Poisson result distribution — sums to ~1 by construction
 * (the grid is truncated at MAX_GOALS_CONSIDERED, so it's very slightly
 * under 1; ensemble.ts re-normalizes before combining models). */
export function matchResultProbabilities(homeXg: number, awayXg: number): MatchResultProbabilities {
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let h = 0; h <= MAX_GOALS_CONSIDERED; h++) {
    for (let a = 0; a <= MAX_GOALS_CONSIDERED; a++) {
      const p = poissonPmf(homeXg, h) * poissonPmf(awayXg, a);
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
    }
  }
  return { pHome, pDraw, pAway };
}

/** P(total goals > 1.5) / P(total goals > 2.5) from the same Poisson grid,
 * kept consistent with matchResultProbabilities rather than a separate
 * approximation. */
export function overUnderProbabilities(homeXg: number, awayXg: number): { pOver15: number; pOver25: number } {
  let pOver15 = 0, pOver25 = 0;
  for (let h = 0; h <= MAX_GOALS_CONSIDERED; h++) {
    for (let a = 0; a <= MAX_GOALS_CONSIDERED; a++) {
      const p = poissonPmf(homeXg, h) * poissonPmf(awayXg, a);
      const total = h + a;
      if (total > 1.5) pOver15 += p;
      if (total > 2.5) pOver25 += p;
    }
  }
  return { pOver15, pOver25 };
}

/** BTTS from the independent-scoring assumption baked into the Poisson
 * grid: P(both score) = (1 - P(home=0)) * (1 - P(away=0)). */
export function bttsProbability(homeXg: number, awayXg: number): number {
  const pHomeBlank = poissonPmf(homeXg, 0);
  const pAwayBlank = poissonPmf(awayXg, 0);
  return (1 - pHomeBlank) * (1 - pAwayBlank);
}
