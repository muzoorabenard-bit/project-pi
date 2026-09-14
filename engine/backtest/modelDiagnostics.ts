import type { ApprovedMarket } from "../markets/whitelist.js";
import type { ModelProbabilities } from "../types.js";
import { buildModelSignals, combineSignals, DEFAULT_ENSEMBLE_WEIGHTS, type EnsembleWeights } from "../models/ensemble.js";
import { resolveOutcome } from "./resolveOutcome.js";
import { brierScoreFor, calibrationTableFor, logLossFor, SPEC_CALIBRATION_BINS, type CalibrationBucket, type ProbabilityOutcomePair } from "./metrics.js";
import type { BacktestableRecord } from "./historicalSnapshotProvider.js";

/**
 * Mirrors rankMarkets.ts's market→probability-field mapping (Section 3's
 * approved-market list) — kept as its own small function rather than
 * exported from rankMarkets.ts because that module's version is tightly
 * coupled to odds resolution and TeamFeatures, not just raw
 * ModelProbabilities. TEAM_GOALS has no per-model equivalent (only the
 * ranking layer computes it from a separate single-team Poisson query) —
 * returns null, meaning that market is simply excluded from per-model
 * diagnostics, same as it's excluded from odds-based metrics elsewhere.
 */
export function extractProbabilityForMarket(probs: Partial<ModelProbabilities>, market: ApprovedMarket, selection: string): number | null {
  switch (market) {
    case "HOME_WIN":
      return probs.pHome ?? null;
    case "DRAW":
      return probs.pDraw ?? null;
    case "AWAY_WIN":
      return probs.pAway ?? null;
    case "HOME_DRAW":
      return probs.pHome !== undefined && probs.pDraw !== undefined ? probs.pHome + probs.pDraw : null;
    case "HOME_AWAY":
      return probs.pHome !== undefined && probs.pAway !== undefined ? probs.pHome + probs.pAway : null;
    case "DRAW_AWAY":
      return probs.pDraw !== undefined && probs.pAway !== undefined ? probs.pDraw + probs.pAway : null;
    case "OVER_1_5":
      return probs.pOver15 ?? null;
    case "OVER_2_5":
      return probs.pOver25 ?? null;
    case "UNDER_2_5":
      return probs.pOver25 !== undefined ? 1 - probs.pOver25 : null;
    case "BTTS_YES":
      return probs.pBtts ?? null;
    case "BTTS_NO":
      return probs.pBtts !== undefined ? 1 - probs.pBtts : null;
    case "TEAM_GOALS":
      return null;
    default:
      return null;
  }
}

export interface ModelDiagnosticResult {
  modelName: string;
  sampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  calibration: CalibrationBucket[];
}

/**
 * Section 14 — evaluates each of the 4 existing models SEPARATELY (plus the
 * ensemble, recomputed with the same weights for a fair side-by-side), on
 * whatever market each record's decision actually singled out (only
 * VALUE_BET records have a concrete market+selection to compare against —
 * NO_EDGE/COVERAGE_BET records have nothing decided to score a model
 * against). Calls the EXISTING buildModelSignals()/combineSignals()
 * unchanged — never a parallel reimplementation of the models themselves.
 */
export function computeModelDiagnostics(records: BacktestableRecord[], weights: EnsembleWeights = DEFAULT_ENSEMBLE_WEIGHTS): ModelDiagnosticResult[] {
  const pairsByModel = new Map<string, ProbabilityOutcomePair[]>();
  const modelNames = ["poisson", "recentForm", "teamStrength", "goalPattern", "ensemble"];
  for (const name of modelNames) pairsByModel.set(name, []);

  for (const record of records) {
    const { decision } = record;
    if (!decision || decision.decision !== "VALUE_BET" || !decision.predictionMarket || !decision.predictionSelection) continue;

    const signals = buildModelSignals(record.featureSnapshot.home, record.featureSnapshot.away, weights, record.featureSnapshot.leagueAverages);
    const outcome = resolveOutcome(decision.predictionMarket, decision.predictionSelection, record.homeScore, record.awayScore);
    if (outcome === "void") continue; // no win/loss to score a probability against
    const won = outcome === "win";

    for (const signal of signals) {
      const p = extractProbabilityForMarket(signal.probabilities, decision.predictionMarket, decision.predictionSelection);
      if (p !== null) pairsByModel.get(signal.name)!.push({ probability: p, won });
    }

    const ensembleProbs = combineSignals(signals);
    const ensembleP = extractProbabilityForMarket(ensembleProbs, decision.predictionMarket, decision.predictionSelection);
    if (ensembleP !== null) pairsByModel.get("ensemble")!.push({ probability: ensembleP, won });
  }

  return modelNames.map((modelName) => {
    const pairs = pairsByModel.get(modelName)!;
    return {
      modelName,
      sampleSize: pairs.length,
      brierScore: brierScoreFor(pairs),
      logLoss: logLossFor(pairs),
      calibration: calibrationTableFor(pairs, SPEC_CALIBRATION_BINS),
    };
  });
}
