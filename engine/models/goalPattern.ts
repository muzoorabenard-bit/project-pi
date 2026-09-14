import type { ModelProbabilities, TeamFeatures } from "../types.js";

// Adapted from project-pi/supabase/functions/analyze-matches/index.ts's
// existing pressureModel() — a goals-approximated "pressure index" (no
// shots/xG data available from football-data.org) mapped to Over/Under 2.5
// via a small empirical lookup table. Extended here with a BTTS estimate
// derived the same way analyze-matches already computes it elsewhere
// (sqrt of the two teams' BTTS rates), so this model produces a full
// ModelProbabilities shape rather than only goals totals.

const PRESSURE_TABLE: { pressure: number; pOver25: number }[] = [
  { pressure: 24, pOver25: 0.422 },
  { pressure: 28, pOver25: 0.429 },
  { pressure: 32, pOver25: 0.436 },
  { pressure: 36, pOver25: 0.442 },
  { pressure: 40, pOver25: 0.449 },
  { pressure: 44, pOver25: 0.456 },
  { pressure: 48, pOver25: 0.463 },
];

function nearestPressureBin(total: number): { pOver25: number } {
  const nearest = PRESSURE_TABLE.reduce((prev, curr) =>
    Math.abs(curr.pressure - total) < Math.abs(prev.pressure - total) ? curr : prev,
  );
  return { pOver25: nearest.pOver25 };
}

/**
 * Model D — goal-pattern signal (Phase 2 spec, Section 6, model #4). Result
 * (1X2) is intentionally left neutral (1/3 each) — this model has nothing
 * to say about who wins, only how many goals the match produces; the
 * ensemble weights it near-zero for 1X2 and primarily for the goals markets.
 */
export function goalPatternModel(home: TeamFeatures, away: TeamFeatures): ModelProbabilities {
  const homeAtt = (home.home?.goalsScoredAvg ?? home.overall.goalsScoredAvg ?? 1.4) * 11.4;
  const homeDef = (away.away?.goalsConcededAvg ?? away.overall.goalsConcededAvg ?? 1.4) * 12;
  const awayAtt = (away.away?.goalsScoredAvg ?? away.overall.goalsScoredAvg ?? 1.4) * 11.4;
  const awayDef = (home.home?.goalsConcededAvg ?? home.overall.goalsConcededAvg ?? 1.4) * 12;

  const expectedHome = (homeAtt + awayDef) / 2;
  const expectedAway = (awayAtt + homeDef) / 2;
  const total = expectedHome + expectedAway;

  const { pOver25 } = nearestPressureBin(total);

  const homeBtts = home.overall.bttsRate ?? 0.5;
  const awayBtts = away.overall.bttsRate ?? 0.5;
  const pBtts = Math.sqrt(homeBtts * awayBtts);

  return {
    pHome: 1 / 3,
    pDraw: 1 / 3,
    pAway: 1 / 3,
    pBtts,
    pOver15: Math.min(0.97, pOver25 + 0.2),
    pOver25,
  };
}
