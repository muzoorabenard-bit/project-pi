import type { BacktestRow } from "./replay.js";

export interface PerformanceSummary {
  betsCount: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number | null;
  avgOdds: number | null;
  avgEdge: number | null;
  avgEv: number | null;
  totalProfit: number; // in units of stake (1 unit per bet)
  roi: number | null; // totalProfit / betsCount (stake-weighted, 1 unit each)
  maxDrawdown: number; // largest peak-to-trough drop in cumulative profit, in units
}

function bettableRows(rows: BacktestRow[]): BacktestRow[] {
  return rows.filter((r) => r.decision.decision === "VALUE_BET" && r.payout !== null);
}

export function summarizePerformance(rows: BacktestRow[]): PerformanceSummary {
  const bettable = bettableRows(rows);

  const wins = bettable.filter((r) => r.outcome === "win").length;
  const losses = bettable.filter((r) => r.outcome === "loss").length;
  const voids = bettable.filter((r) => r.outcome === "void").length;
  const decidedCount = wins + losses; // voids excluded from win rate, consistent with standard betting-ROI convention

  const odds = bettable.map((r) => r.rankedCandidates.find((c) => c.marketRank === 1)?.bookmakerOdds).filter((o): o is number => o !== null && o !== undefined);
  const edges = bettable.map((r) => r.rankedCandidates.find((c) => c.marketRank === 1)?.edge).filter((e): e is number => e !== null && e !== undefined);
  const evs = bettable.map((r) => r.rankedCandidates.find((c) => c.marketRank === 1)?.ev).filter((e): e is number => e !== null && e !== undefined);

  const totalProfit = bettable.reduce((sum, r) => sum + (r.payout ?? 0), 0);

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of bettable) {
    cumulative += r.payout ?? 0;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  return {
    betsCount: bettable.length,
    wins,
    losses,
    voids,
    winRate: decidedCount > 0 ? wins / decidedCount : null,
    avgOdds: average(odds),
    avgEdge: average(edges),
    avgEv: average(evs),
    totalProfit: +totalProfit.toFixed(4),
    roi: bettable.length > 0 ? +(totalProfit / bettable.length).toFixed(4) : null,
    maxDrawdown: +maxDrawdown.toFixed(4),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(4);
}

export function summarizeByKey<K extends string>(
  rows: BacktestRow[],
  keyFn: (row: BacktestRow) => K,
): Record<K, PerformanceSummary> {
  const groups = new Map<K, BacktestRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const result = {} as Record<K, PerformanceSummary>;
  for (const [key, groupRows] of groups) {
    result[key] = summarizePerformance(groupRows);
  }
  return result;
}

export function summarizeByMarket(rows: BacktestRow[]): Record<string, PerformanceSummary> {
  return summarizeByKey(rows, (r) => r.decision.predictionMarket ?? "NONE");
}

export function summarizeByLeague(rows: BacktestRow[]): Record<string, PerformanceSummary> {
  return summarizeByKey(rows, (r) => r.fixture.league);
}

// ── Probability-agnostic primitives ─────────────────────────────────────
// Extracted so the same math can be applied to any {probability, won} pairs
// — not just the ensemble's marketRank===1 candidate from a live replay.
// engine/backtest/modelDiagnostics.ts reuses these directly for per-model
// (Poisson/recentForm/teamStrength/goalPattern) calibration, so this math
// is written once rather than duplicated.

export interface ProbabilityOutcomePair {
  probability: number;
  won: boolean;
}

/** Brier score: mean squared error between predicted probability and the
 * binary outcome (1 = win, 0 = loss). Lower is better; 0 is perfect. */
export function brierScoreFor(pairs: ProbabilityOutcomePair[]): number | null {
  if (pairs.length === 0) return null;
  const sqErrors = pairs.map((pair) => (pair.probability - (pair.won ? 1 : 0)) ** 2);
  return +average(sqErrors)!.toFixed(4);
}

const LOG_LOSS_EPSILON = 1e-9;

/** Log loss (binary cross-entropy) — heavily penalizes confident-and-wrong
 * predictions more than Brier score does. */
export function logLossFor(pairs: ProbabilityOutcomePair[]): number | null {
  if (pairs.length === 0) return null;
  const losses = pairs.map((pair) => {
    const p = Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, pair.probability));
    const actual = pair.won ? 1 : 0;
    return -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
  });
  return +average(losses)!.toFixed(4);
}

export interface CalibrationBucket {
  bucketStart: number; // e.g. 0.5 for the [0.5, 0.6) bucket
  bucketEnd: number;
  predictedCount: number;
  actualWinRate: number | null;
  avgPredictedProbability: number | null;
}

export interface CalibrationBucketBounds {
  start: number;
  end: number;
}

function uniformBins(width: number): CalibrationBucketBounds[] {
  const bins: CalibrationBucketBounds[] = [];
  for (let start = 0; start < 1; start += width) {
    bins.push({ start: +start.toFixed(4), end: +(start + width).toFixed(4) });
  }
  return bins;
}

export const DEFAULT_UNIFORM_BINS = uniformBins(0.1);

/** The exact, non-uniform bins requested for backtest reports — finer
 * resolution below 30% (where most underdog mispricing questions live),
 * coarser above it. */
export const SPEC_CALIBRATION_BINS: CalibrationBucketBounds[] = [
  { start: 0, end: 0.05 },
  { start: 0.05, end: 0.1 },
  { start: 0.1, end: 0.15 },
  { start: 0.15, end: 0.2 },
  { start: 0.2, end: 0.25 },
  { start: 0.25, end: 0.3 },
  { start: 0.3, end: 0.4 },
  { start: 0.4, end: 0.5 },
  { start: 0.5, end: 0.6 },
  { start: 0.6, end: 0.7 },
  { start: 0.7, end: 0.8 },
  { start: 0.8, end: 0.9 },
  { start: 0.9, end: 1.0 },
];

/** Predicted-probability bucket vs. actual win rate. The last bin's `end`
 * is treated as inclusive so a probability of exactly 1.0 has a home. */
export function calibrationTableFor(pairs: ProbabilityOutcomePair[], bins: CalibrationBucketBounds[] = DEFAULT_UNIFORM_BINS): CalibrationBucket[] {
  return bins.map(({ start, end }, i) => {
    const isLastBin = i === bins.length - 1;
    const inBucket = pairs.filter((p) => p.probability >= start && (isLastBin ? p.probability <= end : p.probability < end));
    const wins = inBucket.filter((p) => p.won).length;

    return {
      bucketStart: +start.toFixed(4),
      bucketEnd: +end.toFixed(4),
      predictedCount: inBucket.length,
      actualWinRate: inBucket.length > 0 ? wins / inBucket.length : null,
      avgPredictedProbability: average(inBucket.map((p) => p.probability)),
    };
  });
}

// ── BacktestRow-based wrappers (existing call sites, unchanged behavior) ──

function toPairs(rows: BacktestRow[]): ProbabilityOutcomePair[] {
  return bettableRows(rows)
    .filter((r) => r.outcome === "win" || r.outcome === "loss")
    .map((r) => ({
      probability: r.rankedCandidates.find((c) => c.marketRank === 1)?.modelProbability ?? 0.5,
      won: r.outcome === "win",
    }));
}

export function brierScore(rows: BacktestRow[]): number | null {
  return brierScoreFor(toPairs(rows));
}

export function logLoss(rows: BacktestRow[]): number | null {
  return logLossFor(toPairs(rows));
}

export function calibrationTable(rows: BacktestRow[]): CalibrationBucket[] {
  return calibrationTableFor(toPairs(rows), DEFAULT_UNIFORM_BINS);
}
