import { describe, expect, it } from "vitest";
import { computeEdgeBuckets } from "../backtest/edgeBuckets.js";
import type { BacktestableRecord, PredictionRecord } from "../backtest/historicalSnapshotProvider.js";
import { makeTeamFeatures } from "./fixtures.js";

function predictionFor(edge: number, odds: number): PredictionRecord {
  return {
    market: "HOME_WIN",
    selection: "HOME",
    modelProbability: 1 / odds + edge,
    bookmakerOdds: odds,
    impliedProbability: 1 / odds,
    edge,
    ev: (1 / odds + edge) * odds - 1,
    confidence: 70,
    dataQuality: "HIGH",
    marketRank: 1,
    oddsCapturedAt: "2026-09-14T05:00:00Z",
  };
}

function record(edge: number, odds: number, homeScore: number, awayScore: number): BacktestableRecord {
  return {
    matchId: `m-${edge}-${odds}`,
    homeTeam: "Home",
    awayTeam: "Away",
    league: "PL",
    kickoffTime: "2026-09-14T16:30:00Z",
    homeScore,
    awayScore,
    featureSnapshot: {
      home: makeTeamFeatures({}, true),
      away: makeTeamFeatures({}, false),
      leagueAverages: { avgGoalsScoredPerTeam: 1.5, avgGoalsConcededPerTeam: 1.5, sampleSize: 10 },
      capturedAt: "2026-09-14T05:00:00Z",
      modelVersion: "phase2-v2",
    },
    decision: { decision: "VALUE_BET", predictionMarket: "HOME_WIN", predictionSelection: "HOME", reason: "test" },
    predictions: [predictionFor(edge, odds)],
  };
}

describe("computeEdgeBuckets", () => {
  it("places a bet in the correct bucket by its edge", () => {
    const buckets = computeEdgeBuckets([record(0.03, 2.0, 1, 0)]);
    const bucket = buckets.find((b) => b.label === "2-5%")!;
    expect(bucket.betsCount).toBe(1);
    expect(bucket.actualWinRate).toBe(1); // home actually won
  });

  it("excludes NO_EDGE decisions and predictions with no odds entirely", () => {
    const noEdgeRecord = { ...record(0.03, 2.0, 1, 0), decision: { decision: "NO_EDGE" as const, predictionMarket: null, predictionSelection: null, reason: "x" } };
    const buckets = computeEdgeBuckets([noEdgeRecord]);
    for (const b of buckets) expect(b.betsCount).toBe(0);
  });

  it("computes ROI and profit consistent with actual win/loss and real odds", () => {
    // Two bets in the same bucket: one wins at odds 2.0 (+1 unit), one loses (-1 unit) -> profit 0, roi 0
    const win = record(0.06, 2.0, 1, 0); // home wins
    const loss = record(0.07, 2.0, 0, 1); // home loses
    const buckets = computeEdgeBuckets([win, loss]);
    const bucket = buckets.find((b) => b.label === "5-10%")!;
    expect(bucket.betsCount).toBe(2);
    expect(bucket.profit).toBeCloseTo(0);
    expect(bucket.roi).toBeCloseTo(0);
  });

  it("places a very large edge in the 100%+ bucket", () => {
    const buckets = computeEdgeBuckets([record(1.5, 3.0, 1, 0)]);
    const bucket = buckets.find((b) => b.label === "100%+")!;
    expect(bucket.betsCount).toBe(1);
  });

  it("every bucket sums to the total input record count when all are VALUE_BET with odds", () => {
    const records = [record(-0.01, 2.0, 0, 0), record(0.01, 2.0, 1, 0), record(0.15, 2.0, 1, 0)];
    const buckets = computeEdgeBuckets(records);
    const total = buckets.reduce((sum, b) => sum + b.betsCount, 0);
    expect(total).toBe(records.length);
  });
});
