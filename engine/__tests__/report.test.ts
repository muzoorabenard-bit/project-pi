import { describe, expect, it } from "vitest";
import { buildBacktestReport, printReport } from "../backtest/report.js";
import type { BacktestableRecord } from "../backtest/historicalSnapshotProvider.js";
import { makeTeamFeatures } from "./fixtures.js";

function record(overrides: Partial<BacktestableRecord> = {}): BacktestableRecord {
  return {
    matchId: "m1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    league: "PL",
    kickoffTime: "2026-09-14T16:30:00Z",
    homeScore: 2,
    awayScore: 0,
    featureSnapshot: {
      home: makeTeamFeatures({}, true),
      away: makeTeamFeatures({}, false),
      leagueAverages: { avgGoalsScoredPerTeam: 1.5, avgGoalsConcededPerTeam: 1.5, sampleSize: 10 },
      capturedAt: "2026-09-14T05:00:00Z",
      modelVersion: "phase2-v2",
    },
    decision: { decision: "VALUE_BET", predictionMarket: "HOME_WIN", predictionSelection: "HOME", reason: "test" },
    predictions: [
      { market: "HOME_WIN", selection: "HOME", modelProbability: 0.6, bookmakerOdds: 1.8, impliedProbability: 0.5556, edge: 0.0444, ev: 0.08, confidence: 74, dataQuality: "HIGH", marketRank: 1, oddsCapturedAt: "2026-09-14T05:30:00Z" },
    ],
    ...overrides,
  };
}

describe("buildBacktestReport", () => {
  it("reports insufficient-data findings when the sample is tiny (today's real situation)", () => {
    const report = buildBacktestReport([record()], [{ matchId: "m2", reason: "match not yet settled (no final score)" }], "2026-09-14", "2026-09-14");
    expect(report.fixturesConsidered).toBe(2);
    expect(report.fixturesBacktestable).toBe(1);
    expect(report.findings.some((f) => f.category === "INSUFFICIENT_DATA")).toBe(true);
  });

  it("counts leakage-detected rejections separately from other exclusions", () => {
    const report = buildBacktestReport(
      [record()],
      [{ matchId: "m2", reason: "LEAKAGE_DETECTED: feature_snapshot captured after kickoff" }, { matchId: "m3", reason: "no feature_snapshots row for this match" }],
      "2026-09-14",
      "2026-09-14",
    );
    const printed = printReport(report);
    expect(printed).toMatch(/Leakage detected: 1/);
    expect(printed).toMatch(/Other exclusions: 1/);
  });

  it("is reproducible: identical inputs produce identical output aside from the timestamp", () => {
    const records = [record()];
    const rejected = [{ matchId: "m2", reason: "match not yet settled (no final score)" }];
    const reportA = buildBacktestReport(records, rejected, "2026-09-14", "2026-09-14");
    const reportB = buildBacktestReport(records, rejected, "2026-09-14", "2026-09-14");

    const { generatedAt: _a, ...restA } = reportA;
    const { generatedAt: _b, ...restB } = reportB;
    expect(restA).toEqual(restB);
  });

  it("printReport produces every required section header", () => {
    const report = buildBacktestReport([record()], [], "2026-09-14", "2026-09-14");
    const printed = printReport(report);
    for (const heading of [
      "BACKTEST REPORT",
      "MODEL CALIBRATION",
      "MARKET PERFORMANCE",
      "EDGE ANALYSIS",
      "EXTREME PREDICTIONS",
      "LEAGUE PERFORMANCE",
      "INTER-MODEL AGREEMENT",
      "MARKET BASELINE COMPARISON",
      "LEAKAGE",
      "DATA QUALITY",
      "WHAT IS ACTUALLY BROKEN?",
      "CONCLUSION",
    ]) {
      expect(printed).toContain(heading);
    }
  });

  it("never claims profitability when the sample is below the minimum for a conclusion", () => {
    const report = buildBacktestReport([record()], [], "2026-09-14", "2026-09-14");
    const printed = printReport(report);
    expect(printed.toLowerCase()).not.toMatch(/is profitable/);
    expect(printed).toMatch(/Insufficient data/);
  });
});
