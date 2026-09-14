import { buildModelSignals, DEFAULT_ENSEMBLE_WEIGHTS, type EnsembleWeights } from "../models/ensemble.js";
import { extractProbabilityForMarket } from "./modelDiagnostics.js";
import { resolveOutcome, type Outcome } from "./resolveOutcome.js";
import type { BacktestableRecord } from "./historicalSnapshotProvider.js";

export interface ExtremeAuditThresholds {
  minModelProbability: number;
  minEdge: number;
  evThresholds: number[]; // reported per-threshold, e.g. [0.5, 1.0, 2.0]
}

export const DEFAULT_EXTREME_THRESHOLDS: ExtremeAuditThresholds = {
  minModelProbability: 0.7,
  minEdge: 0.2,
  evThresholds: [0.5, 1.0, 2.0],
};

export interface ExtremeAuditEntry {
  matchId: string;
  fixture: string;
  market: string;
  selection: string;
  modelProbability: number;
  impliedProbability: number | null;
  bookmakerOdds: number | null;
  edge: number | null;
  ev: number | null;
  modelByModel: Record<string, number>;
  dataQuality: string;
  homeSampleSize: number;
  awaySampleSize: number;
  actualOutcome: Outcome | null;
}

/**
 * Section 16 — a dedicated report for predictions crossing extreme
 * probability/edge/EV thresholds, with model-by-model probabilities
 * attached so a reviewer can immediately see whether the extremity came
 * from one runaway model or genuine agreement across all four.
 */
export function auditExtremePredictions(
  records: BacktestableRecord[],
  thresholds: ExtremeAuditThresholds = DEFAULT_EXTREME_THRESHOLDS,
  weights: EnsembleWeights = DEFAULT_ENSEMBLE_WEIGHTS,
): ExtremeAuditEntry[] {
  const entries: ExtremeAuditEntry[] = [];

  for (const record of records) {
    for (const prediction of record.predictions) {
      const crossesProbability = prediction.modelProbability >= thresholds.minModelProbability;
      const crossesEdge = prediction.edge !== null && prediction.edge >= thresholds.minEdge;
      const crossesEv = prediction.ev !== null && thresholds.evThresholds.some((t) => prediction.ev! >= t);
      if (!crossesProbability && !crossesEdge && !crossesEv) continue;

      const signals = buildModelSignals(record.featureSnapshot.home, record.featureSnapshot.away, weights, record.featureSnapshot.leagueAverages);
      const modelByModel: Record<string, number> = {};
      for (const signal of signals) {
        const p = extractProbabilityForMarket(signal.probabilities, prediction.market, prediction.selection);
        if (p !== null) modelByModel[signal.name] = p;
      }

      entries.push({
        matchId: record.matchId,
        fixture: `${record.homeTeam} vs ${record.awayTeam}`,
        market: prediction.market,
        selection: prediction.selection,
        modelProbability: prediction.modelProbability,
        impliedProbability: prediction.impliedProbability,
        bookmakerOdds: prediction.bookmakerOdds,
        edge: prediction.edge,
        ev: prediction.ev,
        modelByModel,
        dataQuality: prediction.dataQuality,
        homeSampleSize: record.featureSnapshot.home.overall.played,
        awaySampleSize: record.featureSnapshot.away.overall.played,
        actualOutcome: resolveOutcome(prediction.market, prediction.selection, record.homeScore, record.awayScore),
      });
    }
  }

  return entries;
}
