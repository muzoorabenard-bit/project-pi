import type { BettingDecisionResult, RankedPrediction } from "../types.js";

export interface DecisionThresholds {
  minimumEdge: number; // e.g. 0.03 = 3 percentage points
  minimumConfidence: number; // 0-100
  coverageStakeEnabled: boolean; // Section 9/31 — off by default; a product decision, not a math one
}

export const DEFAULT_DECISION_THRESHOLDS: DecisionThresholds = {
  minimumEdge: 0.03,
  minimumConfidence: 65,
  coverageStakeEnabled: false,
};

/**
 * Deterministic — no LLM involvement (Phase 2 spec, Section 12). Takes the
 * already-ranked candidate list for one fixture (rankMarkets.ts's output,
 * best EV first) and classifies the outcome. Never manipulates the
 * candidates themselves to force a VALUE_BET (Section 9) — it only reads
 * `market_rank === 1`'s numbers against the configured thresholds.
 */
export function decideBet(
  rankedCandidates: RankedPrediction[],
  thresholds: DecisionThresholds = DEFAULT_DECISION_THRESHOLDS,
): BettingDecisionResult {
  const best = rankedCandidates.find((c) => c.marketRank === 1);

  if (!best) {
    return { decision: "NO_EDGE", reason: "no candidates were generated for this fixture", predictionMarket: null, predictionSelection: null };
  }

  if (best.edge === null || best.ev === null) {
    return withCoverageFallback(
      thresholds,
      `top-ranked candidate (${best.market}/${best.selection}) has no bookmaker odds — edge/EV cannot be computed`,
    );
  }

  if (best.edge < thresholds.minimumEdge) {
    return withCoverageFallback(
      thresholds,
      `top-ranked candidate's edge (${(best.edge * 100).toFixed(1)}%) is below the minimum (${(thresholds.minimumEdge * 100).toFixed(1)}%)`,
    );
  }

  if (best.confidence < thresholds.minimumConfidence) {
    return withCoverageFallback(
      thresholds,
      `top-ranked candidate's confidence (${best.confidence}) is below the minimum (${thresholds.minimumConfidence})`,
    );
  }

  return {
    decision: "VALUE_BET",
    reason: `${best.market}/${best.selection}: edge ${(best.edge * 100).toFixed(1)}%, EV ${(best.ev * 100).toFixed(1)}%, confidence ${best.confidence}`,
    predictionMarket: best.market,
    predictionSelection: best.selection,
  };
}

function withCoverageFallback(thresholds: DecisionThresholds, noEdgeReason: string): BettingDecisionResult {
  if (!thresholds.coverageStakeEnabled) {
    return { decision: "NO_EDGE", reason: noEdgeReason, predictionMarket: null, predictionSelection: null };
  }
  // COVERAGE_BET is a deliberate, separately-tracked product decision
  // (Section 9/31) — never silently indistinguishable from a real VALUE_BET
  // in the stored reason text.
  return {
    decision: "COVERAGE_BET",
    reason: `NO_EDGE (${noEdgeReason}), but coverage staking is enabled — this is a mandatory-coverage bet, not a value bet`,
    predictionMarket: null,
    predictionSelection: null,
  };
}
