import type { ModelProbabilities, TeamFeatures } from "../types.js";

const HOME_ADVANTAGE_POINTS = 0.15; // added to home's points-per-game before comparing

// League-average points-per-game is EXACTLY 1.5, not an estimate — every
// match distributes either 3+0 or 1+1 points across the two teams, so the
// per-team average across any complete set of matches is always 1.5
// regardless of the league. Used as the shrinkage target below.
const LEAGUE_AVERAGE_PPG = 1.5;

// How many "phantom average games" to blend into a small sample before
// trusting it — empirical-Bayes-style shrinkage. Without this, a team's
// ppg after just 1-4 games (early season, or this project's own early data
// history) can look far more extreme than its true season strength, and
// this model would treat that noise as a confident signal at full weight.
// Provisional, pending real backtested calibration (see engine/backtest).
const SHRINKAGE_GAMES = 8;

function shrunkPointsPerGame(wins: number, draws: number, played: number): number {
  if (played === 0) return LEAGUE_AVERAGE_PPG;
  const raw = (wins * 3 + draws) / played;
  return (raw * played + LEAGUE_AVERAGE_PPG * SHRINKAGE_GAMES) / (played + SHRINKAGE_GAMES);
}

/**
 * Model B — recent-form signal (Phase 2 spec, Section 6, model #2).
 * Independent of the Poisson goal model: converts each team's W/D/L record
 * into a strength differential and maps that to a result distribution via a
 * bounded logistic-style curve, rather than a goals simulation. Goals
 * markets fall back directly to each team's own stored BTTS/Over rates
 * (averaged across the two teams) since form alone has no goals dimension.
 */
export function recentFormModel(home: TeamFeatures, away: TeamFeatures): ModelProbabilities {
  const homePpg = shrunkPointsPerGame(home.overall.wins, home.overall.draws, home.overall.played) + HOME_ADVANTAGE_POINTS;
  const awayPpg = shrunkPointsPerGame(away.overall.wins, away.overall.draws, away.overall.played);

  const diff = homePpg - awayPpg; // roughly in [-3, 3]
  const homeStrength = 1 / (1 + Math.exp(-diff)); // logistic squash to (0,1)

  // homeStrength is "probability home is the stronger side" — spread that
  // into a 3-way result distribution with a draw band that shrinks as the
  // strength gap widens.
  const drawWidth = 0.32 - Math.min(0.18, Math.abs(diff) * 0.06);
  const pDraw = Math.max(0.15, drawWidth);
  const remaining = 1 - pDraw;
  const pHome = remaining * homeStrength;
  const pAway = remaining * (1 - homeStrength);

  const bttsRate =
    home.overall.bttsRate !== null && away.overall.bttsRate !== null
      ? (home.overall.bttsRate + away.overall.bttsRate) / 2
      : (home.overall.bttsRate ?? away.overall.bttsRate ?? 0.5);

  const over25Rate =
    home.overall.over25Rate !== null && away.overall.over25Rate !== null
      ? (home.overall.over25Rate + away.overall.over25Rate) / 2
      : (home.overall.over25Rate ?? away.overall.over25Rate ?? 0.5);

  return {
    pHome,
    pDraw,
    pAway,
    pBtts: bttsRate,
    pOver15: Math.min(0.97, over25Rate + 0.2), // Over 1.5 is always >= Over 2.5 rate; +0.2 is a coarse but directionally-safe bump, not a fitted value
    pOver25: over25Rate,
  };
}
