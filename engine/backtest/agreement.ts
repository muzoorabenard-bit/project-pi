import { buildModelSignals, DEFAULT_ENSEMBLE_WEIGHTS, type EnsembleWeights } from "../models/ensemble.js";
import { extractProbabilityForMarket } from "./modelDiagnostics.js";
import type { BacktestableRecord } from "./historicalSnapshotProvider.js";

export interface AgreementRow {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  selection: string;
  modelProbabilityMin: number;
  modelProbabilityMax: number;
  modelProbabilityMean: number;
  modelProbabilityStddev: number;
  modelProbabilities: Record<string, number>; // named, for display (Section 15's worked example)
}

function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Section 15 — inter-model agreement, diagnostic only (never used to change
 * the ensemble). Only meaningful for records with a concrete decided
 * market+selection (VALUE_BET) and where at least one model actually has an
 * opinion on that market (TEAM_GOALS has none — see modelDiagnostics.ts).
 */
export function computeAgreement(records: BacktestableRecord[], weights: EnsembleWeights = DEFAULT_ENSEMBLE_WEIGHTS): AgreementRow[] {
  const rows: AgreementRow[] = [];

  for (const record of records) {
    const { decision } = record;
    if (!decision || decision.decision !== "VALUE_BET" || !decision.predictionMarket || !decision.predictionSelection) continue;

    const signals = buildModelSignals(record.featureSnapshot.home, record.featureSnapshot.away, weights, record.featureSnapshot.leagueAverages);
    const named: Record<string, number> = {};
    for (const signal of signals) {
      const p = extractProbabilityForMarket(signal.probabilities, decision.predictionMarket, decision.predictionSelection);
      if (p !== null) named[signal.name] = p;
    }

    const values = Object.values(named);
    if (values.length === 0) continue;

    const mean = values.reduce((s, v) => s + v, 0) / values.length;

    rows.push({
      matchId: record.matchId,
      homeTeam: record.homeTeam,
      awayTeam: record.awayTeam,
      market: decision.predictionMarket,
      selection: decision.predictionSelection,
      modelProbabilityMin: Math.min(...values),
      modelProbabilityMax: Math.max(...values),
      modelProbabilityMean: +mean.toFixed(4),
      modelProbabilityStddev: +stddev(values, mean).toFixed(4),
      modelProbabilities: named,
    });
  }

  return rows;
}
