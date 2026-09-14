import { describe, expect, it } from "vitest";
import { auditExtremePredictions } from "../backtest/extremeAudit.js";
import type { BacktestableRecord } from "../backtest/historicalSnapshotProvider.js";
import { makeTeamFeatures } from "./fixtures.js";

function record(predictions: BacktestableRecord["predictions"]): BacktestableRecord {
  return {
    matchId: "m1",
    homeTeam: "Inter",
    awayTeam: "Udinese",
    league: "SA",
    kickoffTime: "2026-09-14T16:30:00Z",
    homeScore: 2,
    awayScore: 0,
    featureSnapshot: {
      home: makeTeamFeatures({}, true),
      away: makeTeamFeatures({}, false),
      leagueAverages: { avgGoalsScoredPerTeam: 1.85, avgGoalsConcededPerTeam: 1.24, sampleSize: 6 },
      capturedAt: "2026-09-14T05:00:00Z",
      modelVersion: "phase2-v2",
    },
    decision: { decision: "VALUE_BET", predictionMarket: "AWAY_WIN", predictionSelection: "AWAY", reason: "test" },
    predictions,
  };
}

const extremeOverPrediction = {
  market: "OVER_2_5" as const,
  selection: "OVER",
  modelProbability: 0.75,
  bookmakerOdds: 1.4,
  impliedProbability: 0.714,
  edge: 0.036,
  ev: 0.05,
  confidence: 74,
  dataQuality: "HIGH",
  marketRank: 1,
  oddsCapturedAt: "2026-09-14T05:30:00Z",
};

const hugeEvPrediction = {
  market: "AWAY_WIN" as const,
  selection: "AWAY",
  modelProbability: 0.214,
  bookmakerOdds: 14.31,
  impliedProbability: 0.0699,
  edge: 0.144,
  ev: 2.06,
  confidence: 74,
  dataQuality: "HIGH",
  marketRank: 2,
  oddsCapturedAt: "2026-09-14T05:30:00Z",
};

const ordinaryPrediction = {
  market: "BTTS_YES" as const,
  selection: "YES",
  modelProbability: 0.55,
  bookmakerOdds: 2.0,
  impliedProbability: 0.5,
  edge: 0.05,
  ev: 0.1,
  confidence: 70,
  dataQuality: "HIGH",
  marketRank: 3,
  oddsCapturedAt: "2026-09-14T05:30:00Z",
};

describe("auditExtremePredictions", () => {
  it("flags a prediction crossing the model-probability threshold (>=70%)", () => {
    const entries = auditExtremePredictions([record([extremeOverPrediction])]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.market).toBe("OVER_2_5");
  });

  it("flags a prediction crossing an EV threshold even with modest probability", () => {
    const entries = auditExtremePredictions([record([hugeEvPrediction])]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ev).toBeGreaterThan(2.0);
  });

  it("does not flag an ordinary prediction below every threshold", () => {
    const entries = auditExtremePredictions([record([ordinaryPrediction])]);
    expect(entries).toHaveLength(0);
  });

  it("attaches model-by-model probabilities and the real outcome", () => {
    const entries = auditExtremePredictions([record([hugeEvPrediction])]);
    expect(Object.keys(entries[0]!.modelByModel).length).toBeGreaterThan(0);
    expect(entries[0]!.actualOutcome).toBe("loss"); // away actually lost 0-2
    expect(entries[0]!.homeSampleSize).toBeGreaterThanOrEqual(0);
  });

  it("audits every crossing prediction independently, not just the decided one", () => {
    const entries = auditExtremePredictions([record([extremeOverPrediction, hugeEvPrediction, ordinaryPrediction])]);
    expect(entries).toHaveLength(2);
  });
});
