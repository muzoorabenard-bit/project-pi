import type { ModelProbabilities, ModelSignal, TeamFeatures } from "../types.js";
import { bttsProbability, expectedGoals, matchResultProbabilities, overUnderProbabilities } from "./poisson.js";
import { attackStrength, defenseStrength, FALLBACK_LEAGUE_AVERAGES, type LeagueAverages } from "./leagueAverages.js";
import { recentFormModel } from "./recentForm.js";
import { teamStrengthModel } from "./teamStrength.js";
import { goalPatternModel } from "./goalPattern.js";

// Modest, documented-as-provisional home-advantage multiplier applied to
// the home side's strength-adjusted expected goals only — separate from
// attack/defense strength itself, which is opponent-quality normalization,
// not venue effect.
const HOME_ADVANTAGE_MULTIPLIER = 1.1;

export interface EnsembleWeights {
  poisson: number;
  recentForm: number;
  teamStrength: number;
  goalPattern: number;
}

// Poisson gets the largest weight for 1X2 (it's the only model with an
// actual goals simulation behind it); goalPattern is weighted primarily for
// the goals markets (see its own neutral 1X2 output). These are starting
// values per the spec's "provisional, validated through backtesting" intent
// — not fitted, and expected to move once engine/backtest/metrics.ts has
// real calibration data to tune against.
export const DEFAULT_ENSEMBLE_WEIGHTS: EnsembleWeights = {
  poisson: 0.45,
  recentForm: 0.25,
  teamStrength: 0.15,
  goalPattern: 0.15,
};

function poissonModelSignal(home: TeamFeatures, away: TeamFeatures, league: LeagueAverages): ModelProbabilities {
  const homeAttAvg = home.home?.goalsScoredAvg ?? home.overall.goalsScoredAvg ?? league.avgGoalsScoredPerTeam;
  const awayDefAvg = away.away?.goalsConcededAvg ?? away.overall.goalsConcededAvg ?? league.avgGoalsConcededPerTeam;
  const awayAttAvg = away.away?.goalsScoredAvg ?? away.overall.goalsScoredAvg ?? league.avgGoalsScoredPerTeam;
  const homeDefAvg = home.home?.goalsConcededAvg ?? home.overall.goalsConcededAvg ?? league.avgGoalsConcededPerTeam;

  const homeXg = expectedGoals(attackStrength(homeAttAvg, league), defenseStrength(awayDefAvg, league), league.avgGoalsScoredPerTeam) * HOME_ADVANTAGE_MULTIPLIER;
  const awayXg = expectedGoals(attackStrength(awayAttAvg, league), defenseStrength(homeDefAvg, league), league.avgGoalsScoredPerTeam);

  const { pHome, pDraw, pAway } = matchResultProbabilities(homeXg, awayXg);
  const { pOver15, pOver25 } = overUnderProbabilities(homeXg, awayXg);
  const pBtts = bttsProbability(homeXg, awayXg);

  return { pHome, pDraw, pAway, pBtts, pOver15, pOver25 };
}

/** Normalizes pHome/pDraw/pAway to sum to exactly 1 — Poisson's truncated
 * grid and the heuristic models can each be very slightly off. */
function normalizeResultProbs(p: ModelProbabilities): ModelProbabilities {
  const sum = p.pHome + p.pDraw + p.pAway;
  if (sum <= 0) return { ...p, pHome: 1 / 3, pDraw: 1 / 3, pAway: 1 / 3 };
  return { ...p, pHome: p.pHome / sum, pDraw: p.pDraw / sum, pAway: p.pAway / sum };
}

export function buildModelSignals(
  home: TeamFeatures,
  away: TeamFeatures,
  weights: EnsembleWeights = DEFAULT_ENSEMBLE_WEIGHTS,
  league: LeagueAverages = FALLBACK_LEAGUE_AVERAGES,
): ModelSignal[] {
  return [
    { name: "poisson", weight: weights.poisson, probabilities: poissonModelSignal(home, away, league) },
    { name: "recentForm", weight: weights.recentForm, probabilities: recentFormModel(home, away) },
    { name: "teamStrength", weight: weights.teamStrength, probabilities: teamStrengthModel(home, away) },
    { name: "goalPattern", weight: weights.goalPattern, probabilities: goalPatternModel(home, away) },
  ];
}

/**
 * Combines model signals into one calibrated-shape probability set via a
 * simple weighted average, then re-normalizes the 1X2 triple to sum to
 * exactly 1 (Phase 2 spec Section 6: "Validate this automatically").
 * Weights need not sum to 1 — they're normalized here too, so callers can
 * pass relative weights freely.
 */
export function combineSignals(signals: ModelSignal[]): ModelProbabilities {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("combineSignals: total model weight must be > 0");
  }

  const acc: ModelProbabilities = { pHome: 0, pDraw: 0, pAway: 0, pBtts: 0, pOver15: 0, pOver25: 0 };
  const key = (k: keyof ModelProbabilities) => k;

  for (const signal of signals) {
    const w = signal.weight / totalWeight;
    for (const field of ["pHome", "pDraw", "pAway", "pBtts", "pOver15", "pOver25"] as const) {
      const value = signal.probabilities[key(field)];
      if (value !== undefined) acc[field] += w * value;
    }
  }

  return normalizeResultProbs(acc);
}

/** Throws if any probability is out of [0,1] or the 1X2 triple doesn't sum
 * to ~1 — a hard invariant check, not a soft warning (Section 6). */
export function assertValidProbabilities(p: ModelProbabilities): void {
  for (const field of ["pHome", "pDraw", "pAway", "pBtts", "pOver15", "pOver25"] as const) {
    const v = p[field];
    if (Number.isNaN(v) || v < 0 || v > 1) {
      throw new Error(`assertValidProbabilities: ${field}=${v} is outside [0,1]`);
    }
  }
  const sum = p.pHome + p.pDraw + p.pAway;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`assertValidProbabilities: pHome+pDraw+pAway=${sum}, expected ~1`);
  }
}

export function runEnsemble(
  home: TeamFeatures,
  away: TeamFeatures,
  weights?: EnsembleWeights,
  league?: LeagueAverages,
): ModelProbabilities {
  const signals = buildModelSignals(home, away, weights, league);
  const combined = combineSignals(signals);
  assertValidProbabilities(combined);
  return combined;
}
