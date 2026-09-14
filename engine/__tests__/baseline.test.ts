import { describe, expect, it } from "vitest";
import { compareAgainstMarketBaseline } from "../backtest/baseline.js";
import type { BacktestableRecord } from "../backtest/historicalSnapshotProvider.js";
import { makeTeamFeatures } from "./fixtures.js";

function fullMatchRecord(homeOdds: number, drawOdds: number, awayOdds: number, homeScore: number, awayScore: number, decidedMarket: "HOME_WIN" | "DRAW" | "AWAY_WIN") {
  const base = {
    modelProbability: 0.5,
    confidence: 70,
    dataQuality: "HIGH",
    marketRank: 1,
    oddsCapturedAt: "2026-09-14T05:30:00Z",
  };
  const record: BacktestableRecord = {
    matchId: "m1",
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
    decision: { decision: "VALUE_BET", predictionMarket: decidedMarket, predictionSelection: decidedMarket === "HOME_WIN" ? "HOME" : decidedMarket === "DRAW" ? "DRAW" : "AWAY", reason: "test" },
    predictions: [
      { ...base, market: "HOME_WIN", selection: "HOME", bookmakerOdds: homeOdds, impliedProbability: 1 / homeOdds, edge: 0.03, ev: 0.02 },
      { ...base, market: "DRAW", selection: "DRAW", bookmakerOdds: drawOdds, impliedProbability: 1 / drawOdds, edge: 0.03, ev: 0.02 },
      { ...base, market: "AWAY_WIN", selection: "AWAY", bookmakerOdds: awayOdds, impliedProbability: 1 / awayOdds, edge: 0.03, ev: 0.02 },
    ],
  };
  return record;
}

describe("compareAgainstMarketBaseline", () => {
  it("only includes records where all three 1X2 prices exist", () => {
    const missingDraw = fullMatchRecord(1.8, 3.6, 4.2, 1, 0, "HOME_WIN");
    missingDraw.predictions = missingDraw.predictions.filter((p) => p.market !== "DRAW");
    const result = compareAgainstMarketBaseline([missingDraw]);
    expect(result.sampleSize).toBe(0);
  });

  it("computes Brier score for model, raw market, and de-vigged market separately", () => {
    const result = compareAgainstMarketBaseline([fullMatchRecord(1.8, 3.6, 4.2, 1, 0, "HOME_WIN")]);
    expect(result.sampleSize).toBe(1);
    expect(result.model.brierScore).not.toBeNull();
    expect(result.rawMarket.brierScore).not.toBeNull();
    expect(result.normalizedMarket.brierScore).not.toBeNull();
  });

  it("only counts records whose decided market is part of 1X2", () => {
    const record = fullMatchRecord(1.8, 3.6, 4.2, 1, 0, "HOME_WIN");
    const bttsDecision = { ...record, decision: { decision: "VALUE_BET" as const, predictionMarket: "BTTS_YES" as const, predictionSelection: "YES", reason: "x" } };
    expect(compareAgainstMarketBaseline([bttsDecision]).sampleSize).toBe(0);
  });

  it("excludes NO_EDGE decisions", () => {
    const record = fullMatchRecord(1.8, 3.6, 4.2, 1, 0, "HOME_WIN");
    const noEdge = { ...record, decision: { decision: "NO_EDGE" as const, predictionMarket: null, predictionSelection: null, reason: "x" } };
    expect(compareAgainstMarketBaseline([noEdge]).sampleSize).toBe(0);
  });
});
