import { describe, expect, it } from "vitest";
import { assembleHistoricalDataset } from "../backtest/historicalSnapshotProvider.js";
import { makeTeamFeatures } from "./fixtures.js";

function match(overrides: Partial<{ id: string; home_score: number | null; away_score: number | null; kickoff_time: string }> = {}) {
  return {
    id: "m1",
    home_team: "Home FC",
    away_team: "Away FC",
    league: "PL",
    kickoff_time: "2026-09-14T16:30:00Z",
    home_score: 2,
    away_score: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<{ match_id: string; captured_at: string }> = {}) {
  return {
    match_id: "m1",
    captured_at: "2026-09-14T05:00:00Z",
    model_version: "phase2-v2",
    features: { home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false), leagueAverages: { avgGoalsScoredPerTeam: 1.5, avgGoalsConcededPerTeam: 1.5, sampleSize: 10 } },
    ...overrides,
  };
}

describe("assembleHistoricalDataset", () => {
  it("includes a match with a settled score, a valid snapshot, and no leakage", () => {
    const result = assembleHistoricalDataset([match()], new Map([["m1", snapshot()]]), new Map(), new Map());
    expect(result.backtestable).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.backtestable[0]!.homeScore).toBe(2);
  });

  it("rejects (not silently drops) a match with no final score yet", () => {
    const result = assembleHistoricalDataset([match({ home_score: null, away_score: null })], new Map([["m1", snapshot()]]), new Map(), new Map());
    expect(result.backtestable).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/not yet settled/i);
  });

  it("rejects a match with no feature_snapshots row at all — never fabricates one", () => {
    const result = assembleHistoricalDataset([match()], new Map(), new Map(), new Map());
    expect(result.backtestable).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/no feature_snapshots/i);
  });

  it("DELIBERATE LEAKAGE: rejects a match whose snapshot was captured after kickoff", () => {
    const result = assembleHistoricalDataset(
      [match()],
      new Map([["m1", snapshot({ captured_at: "2026-09-14T20:00:00Z" })]]), // after the 16:30 kickoff
      new Map(),
      new Map(),
    );
    expect(result.backtestable).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/LEAKAGE_DETECTED/);
  });

  it("excludes only the specific prediction whose odds were captured after kickoff, keeping the match", () => {
    const predictions = new Map([
      [
        "m1",
        [
          { match_id: "m1", market: "HOME_WIN", selection: "HOME", model_probability: 0.6, bookmaker_odds: 1.8, implied_probability: 0.5556, edge: 0.0444, ev: 0.08, confidence: 70, data_quality: "HIGH", market_rank: 1, odds_captured_at: "2026-09-14T05:30:00Z" },
          { match_id: "m1", market: "AWAY_WIN", selection: "AWAY", model_probability: 0.2, bookmaker_odds: 4.0, implied_probability: 0.25, edge: -0.05, ev: -0.2, confidence: 70, data_quality: "HIGH", market_rank: 2, odds_captured_at: "2026-09-14T18:00:00Z" }, // after kickoff — should be excluded
        ],
      ],
    ]);
    const result = assembleHistoricalDataset([match()], new Map([["m1", snapshot()]]), predictions, new Map());
    expect(result.backtestable).toHaveLength(1);
    expect(result.backtestable[0]!.predictions).toHaveLength(1);
    expect(result.backtestable[0]!.predictions[0]!.market).toBe("HOME_WIN");
  });

  it("handles missing odds (null bookmakerOdds) without rejecting the prediction — just excluded from betting-performance math elsewhere", () => {
    const predictions = new Map([
      [
        "m1",
        [
          { match_id: "m1", market: "BTTS_YES", selection: "YES", model_probability: 0.6, bookmaker_odds: null, implied_probability: null, edge: null, ev: null, confidence: 70, data_quality: "INSUFFICIENT", market_rank: 5, odds_captured_at: null },
        ],
      ],
    ]);
    const result = assembleHistoricalDataset([match()], new Map([["m1", snapshot()]]), predictions, new Map());
    expect(result.backtestable[0]!.predictions).toHaveLength(1);
    expect(result.backtestable[0]!.predictions[0]!.bookmakerOdds).toBeNull();
  });

  it("attaches the betting decision when one exists, and leaves it null when none does", () => {
    const decisions = new Map([["m1", { match_id: "m1", decision: "VALUE_BET", market: "HOME_WIN", selection: "HOME", reason: "test" }]]);
    const withDecision = assembleHistoricalDataset([match()], new Map([["m1", snapshot()]]), new Map(), decisions);
    expect(withDecision.backtestable[0]!.decision?.decision).toBe("VALUE_BET");

    const withoutDecision = assembleHistoricalDataset([match()], new Map([["m1", snapshot()]]), new Map(), new Map());
    expect(withoutDecision.backtestable[0]!.decision).toBeNull();
  });

  it("falls back to a documented default league average when a snapshot predates that field being recorded", () => {
    const bareSnapshot = { match_id: "m1", captured_at: "2026-09-14T05:00:00Z", model_version: "phase2-v1", features: { home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false) } };
    const result = assembleHistoricalDataset([match()], new Map([["m1", bareSnapshot]]), new Map(), new Map());
    expect(result.backtestable[0]!.featureSnapshot.leagueAverages.sampleSize).toBe(0);
  });
});
