import { describe, expect, it } from "vitest";
import { brierScore, calibrationTable, logLoss, summarizePerformance } from "../backtest/metrics.js";
import type { BacktestRow } from "../backtest/replay.js";
import type { RankedPrediction } from "../types.js";

function winningCandidate(prob: number, odds: number): RankedPrediction {
  return {
    market: "HOME_WIN",
    selection: "HOME",
    modelProbability: prob,
    impliedProbability: 1 / odds,
    bookmakerOdds: odds,
    oddsSource: "football-data.org",
    oddsCapturedAt: new Date().toISOString(),
    edge: prob - 1 / odds,
    ev: prob * odds - 1,
    confidence: 80,
    dataQuality: "HIGH",
    marketRank: 1,
  };
}

function row(outcome: "win" | "loss", prob: number, odds: number): BacktestRow {
  const candidate = winningCandidate(prob, odds);
  return {
    fixture: { id: "f", homeTeam: "H", awayTeam: "A", league: "PL", kickoffTime: "2026-01-01T00:00:00Z" },
    rankedCandidates: [candidate],
    decision: { decision: "VALUE_BET", reason: "test", predictionMarket: "HOME_WIN", predictionSelection: "HOME" },
    outcome,
    payout: outcome === "win" ? odds - 1 : -1,
  };
}

describe("summarizePerformance", () => {
  it("computes win rate, ROI, and cumulative profit correctly", () => {
    const rows = [row("win", 0.6, 2.0), row("loss", 0.6, 2.0), row("win", 0.6, 2.0)];
    const summary = summarizePerformance(rows);
    expect(summary.betsCount).toBe(3);
    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBeCloseTo(2 / 3);
    // profit: +1, -1, +1 = +1 total, over 3 bets -> roi = 1/3
    expect(summary.totalProfit).toBeCloseTo(1);
    expect(summary.roi).toBeCloseTo(1 / 3);
  });

  it("tracks max drawdown across a losing streak", () => {
    const rows = [row("win", 0.6, 2.0), row("loss", 0.6, 2.0), row("loss", 0.6, 2.0), row("loss", 0.6, 2.0)];
    const summary = summarizePerformance(rows);
    // cumulative: +1, 0, -1, -2 -> peak 1, trough -2 -> drawdown 3
    expect(summary.maxDrawdown).toBeCloseTo(3);
  });

  it("returns nulls rather than NaN/0 when there are no bets at all", () => {
    const summary = summarizePerformance([]);
    expect(summary.betsCount).toBe(0);
    expect(summary.winRate).toBeNull();
    expect(summary.roi).toBeNull();
  });
});

describe("calibration metrics", () => {
  it("brierScore is 0 for a perfectly-calibrated-and-correct prediction", () => {
    const rows = [row("win", 1.0, 2.0)];
    expect(brierScore(rows)).toBeCloseTo(0);
  });

  it("brierScore is worse (higher) for a confident wrong prediction than an unsure one", () => {
    const confidentWrong = brierScore([row("loss", 0.95, 2.0)])!;
    const unsureWrong = brierScore([row("loss", 0.55, 2.0)])!;
    expect(confidentWrong).toBeGreaterThan(unsureWrong);
  });

  it("logLoss heavily penalizes a confident-and-wrong prediction", () => {
    const confidentWrong = logLoss([row("loss", 0.99, 2.0)])!;
    const unsureWrong = logLoss([row("loss", 0.55, 2.0)])!;
    expect(confidentWrong).toBeGreaterThan(unsureWrong);
  });

  it("calibrationTable buckets predictions and reports actual win rate per bucket", () => {
    const rows = [row("win", 0.65, 2.0), row("win", 0.68, 2.0), row("loss", 0.62, 2.0)];
    const table = calibrationTable(rows);
    const bucket = table.find((b) => b.bucketStart === 0.6);
    expect(bucket?.predictedCount).toBe(3);
    expect(bucket?.actualWinRate).toBeCloseTo(2 / 3);
  });
});
