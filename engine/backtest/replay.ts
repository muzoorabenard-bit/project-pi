import type { DecisionThresholds } from "../decision/decisionEngine.js";
import { DEFAULT_DECISION_THRESHOLDS, decideBet } from "../decision/decisionEngine.js";
import type { EnsembleWeights } from "../models/ensemble.js";
import { runEnsemble } from "../models/ensemble.js";
import type { MatchOdds } from "../ranking/rankMarkets.js";
import { rankMarketCandidates } from "../ranking/rankMarkets.js";
import type { RankedPrediction, TeamFeatures } from "../types.js";
import { resolveOutcome } from "./resolveOutcome.js";

export interface HistoricalFixtureMeta {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime: string;
}

/** The result — deliberately a SEPARATE object from the fixture metadata
 * handed to feature/odds providers, so there is no field on the object the
 * decision-making step touches that could contain the score. */
export interface HistoricalFixtureResult {
  homeScore: number;
  awayScore: number;
}

/**
 * Leakage guard: both providers receive only `fixture` (id/teams/league/
 * kickoffTime) and are contractually required to return data "as of"
 * `fixture.kickoffTime` — never anything later. The replay engine itself
 * never reads a HistoricalFixtureResult until after `decideBet` has already
 * run, and score data is passed through a completely separate lookup
 * (`getResult`) that the decision path has no reference to at all.
 */
export type FeatureProvider = (fixture: HistoricalFixtureMeta) => { home: TeamFeatures; away: TeamFeatures } | null;
export type OddsProvider = (fixture: HistoricalFixtureMeta) => MatchOdds;
export type ResultProvider = (fixture: HistoricalFixtureMeta) => HistoricalFixtureResult | null;

export interface BacktestRow {
  fixture: HistoricalFixtureMeta;
  rankedCandidates: RankedPrediction[];
  decision: ReturnType<typeof decideBet>;
  outcome: "win" | "loss" | "void" | null; // null when decision was NO_EDGE (nothing to settle)
  payout: number | null; // null when nothing was bet; stake is assumed to be 1 unit for ROI purposes
}

export interface ReplayOptions {
  thresholds?: DecisionThresholds;
  weights?: EnsembleWeights;
}

/**
 * Chronological historical replay (Phase 2 spec, Section 13). Fixtures are
 * always processed in ascending kickoff order regardless of the order
 * they're passed in — callers cannot accidentally feed a future fixture's
 * data into an earlier decision by mis-ordering the input array.
 */
export function replayFixtures(
  fixtures: HistoricalFixtureMeta[],
  featureProvider: FeatureProvider,
  oddsProvider: OddsProvider,
  resultProvider: ResultProvider,
  options: ReplayOptions = {},
): BacktestRow[] {
  const thresholds = options.thresholds ?? DEFAULT_DECISION_THRESHOLDS;
  const sorted = [...fixtures].sort((a, b) => new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime());

  const rows: BacktestRow[] = [];

  for (const fixture of sorted) {
    const features = featureProvider(fixture);
    if (!features) continue; // no honest feature data available as-of this fixture — excluded, not filled in

    const odds = oddsProvider(fixture);
    const probs = runEnsemble(features.home, features.away, options.weights);
    const rankedCandidates = rankMarketCandidates(probs, features.home, features.away, odds);
    const decision = decideBet(rankedCandidates, thresholds);

    // Settlement — the ONLY point in this function that touches
    // HistoricalFixtureResult, and only after the decision above is final.
    let outcome: BacktestRow["outcome"] = null;
    let payout: number | null = null;

    if (decision.decision === "VALUE_BET" && decision.predictionMarket && decision.predictionSelection) {
      const result = resultProvider(fixture);
      const bestCandidate = rankedCandidates.find((c) => c.marketRank === 1);
      if (result && bestCandidate?.bookmakerOdds) {
        outcome = resolveOutcome(decision.predictionMarket, decision.predictionSelection, result.homeScore, result.awayScore);
        payout = outcome === "win" ? bestCandidate.bookmakerOdds - 1 : outcome === "void" ? 0 : -1;
      }
    }

    rows.push({ fixture, rankedCandidates, decision, outcome, payout });
  }

  return rows;
}
