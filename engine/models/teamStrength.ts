import type { ModelProbabilities, TeamFeatures } from "../types.js";

const HOME_ADVANTAGE_POSITIONS = 3; // home team treated as if 3 places higher

// Steepness of the logistic mapping from normalized position gap to win
// probability. The old version used a linear "share of total strength"
// split with a FIXED 0.26 draw band regardless of how big the position gap
// was — verified live 2026-09-14 (Inter, 3rd, vs Udinese, 13th, in a
// 20-team league) that this produced pAway=19.9%, essentially unmoved by
// how lopsided the table gap actually was. A logistic curve on the
// normalized gap, with a draw band that shrinks as the gap widens (mirrors
// recentForm.ts's same pattern), gives pAway≈6.7% for that identical
// input — much closer to BetPawa's own ~7% implied price for that match.
// Provisional like every other constant here, pending real backtested
// calibration (see engine/backtest).
const STEEPNESS = 4;

/**
 * Model C — team-strength signal (Phase 2 spec, Section 6, model #3), driven
 * purely by league table standing rather than recent form or goals.
 * Falls back to a fully neutral 1/3-1/3-1/3 (goals markets: 0.5/0.5/0.5)
 * when either team's league position is unknown (early season, missing
 * data) — never invents a position.
 */
export function teamStrengthModel(home: TeamFeatures, away: TeamFeatures): ModelProbabilities {
  const homePos = home.context.leaguePosition;
  const awayPos = away.context.leaguePosition;
  const totalTeams = home.context.totalTeams ?? away.context.totalTeams;

  if (homePos === null || awayPos === null || totalTeams === null || totalTeams <= 1) {
    return { pHome: 1 / 3, pDraw: 1 / 3, pAway: 1 / 3, pBtts: 0.5, pOver15: 0.6, pOver25: 0.5 };
  }

  // Lower position number = better. effectiveHomePos treats the home side
  // as HOME_ADVANTAGE_POSITIONS places higher than they actually are.
  const effectiveHomePos = Math.max(1, homePos - HOME_ADVANTAGE_POSITIONS);
  // Positive gap = home side better placed; normalized to roughly [-1, 1]
  // by the size of the league table.
  const gap = (awayPos - effectiveHomePos) / (totalTeams - 1);
  const homeStrength = 1 / (1 + Math.exp(-STEEPNESS * gap));

  // Draw band shrinks as the position gap widens — a 1st-vs-20th match is
  // genuinely less likely to end level than two mid-table sides.
  const drawWidth = 0.3 - Math.min(0.2, Math.abs(gap) * 0.5);
  const pDraw = Math.max(0.1, drawWidth);
  const remaining = 1 - pDraw;

  return {
    pHome: remaining * homeStrength,
    pDraw,
    pAway: remaining * (1 - homeStrength),
    pBtts: 0.5,
    pOver15: 0.6,
    pOver25: 0.5,
  };
}
