import { resolveOutcome } from "./resolveOutcome.js";
import type { BacktestableRecord } from "./historicalSnapshotProvider.js";

export interface EdgeBucketBounds {
  label: string;
  min: number; // inclusive
  max: number; // exclusive, Infinity for the open-ended top bucket
}

// Section 12's exact buckets.
export const EDGE_BUCKETS: EdgeBucketBounds[] = [
  { label: "<0%", min: -Infinity, max: 0 },
  { label: "0-2%", min: 0, max: 0.02 },
  { label: "2-5%", min: 0.02, max: 0.05 },
  { label: "5-10%", min: 0.05, max: 0.1 },
  { label: "10-20%", min: 0.1, max: 0.2 },
  { label: "20-50%", min: 0.2, max: 0.5 },
  { label: "50-100%", min: 0.5, max: 1.0 },
  { label: "100%+", min: 1.0, max: Infinity },
];

export interface EdgeBucketResult {
  label: string;
  betsCount: number;
  avgModelProbability: number | null;
  avgImpliedProbability: number | null;
  avgEdge: number | null;
  avgEv: number | null;
  actualWinRate: number | null;
  roi: number | null;
  profit: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(4);
}

/**
 * Section 12 — "do larger predicted edges actually correspond to better
 * real-world outcomes?" Only VALUE_BET records with real odds on the
 * decided market are eligible (an edge bucket needs a real edge number,
 * which requires real odds — Section 7's exclusion rule applies here too).
 */
export function computeEdgeBuckets(records: BacktestableRecord[]): EdgeBucketResult[] {
  return EDGE_BUCKETS.map((bucket) => {
    const inBucket = records.filter((r) => {
      if (!r.decision || r.decision.decision !== "VALUE_BET" || !r.decision.predictionMarket || !r.decision.predictionSelection) return false;
      const prediction = r.predictions.find((p) => p.market === r.decision!.predictionMarket && p.selection === r.decision!.predictionSelection);
      if (!prediction || prediction.edge === null || prediction.bookmakerOdds === null) return false;
      return prediction.edge >= bucket.min && prediction.edge < bucket.max;
    });

    const priced = inBucket.map((r) => ({
      record: r,
      prediction: r.predictions.find((p) => p.market === r.decision!.predictionMarket && p.selection === r.decision!.predictionSelection)!,
    }));

    const decided = priced
      .map(({ record, prediction }) => {
        const outcome = resolveOutcome(record.decision!.predictionMarket!, record.decision!.predictionSelection!, record.homeScore, record.awayScore);
        return { prediction, outcome };
      })
      .filter((x) => x.outcome !== "void");

    const wins = decided.filter((x) => x.outcome === "win").length;
    const profit = decided.reduce((sum, x) => sum + (x.outcome === "win" ? x.prediction.bookmakerOdds! - 1 : -1), 0);

    return {
      label: bucket.label,
      betsCount: priced.length,
      avgModelProbability: average(priced.map((p) => p.prediction.modelProbability)),
      avgImpliedProbability: average(priced.map((p) => p.prediction.impliedProbability).filter((v): v is number => v !== null)),
      avgEdge: average(priced.map((p) => p.prediction.edge).filter((v): v is number => v !== null)),
      avgEv: average(priced.map((p) => p.prediction.ev).filter((v): v is number => v !== null)),
      actualWinRate: decided.length > 0 ? +(wins / decided.length).toFixed(4) : null,
      roi: priced.length > 0 ? +(profit / priced.length).toFixed(4) : null,
      profit: +profit.toFixed(4),
    };
  });
}
