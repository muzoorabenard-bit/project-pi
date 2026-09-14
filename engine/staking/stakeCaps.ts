// FOUNDATION ONLY — see kelly.ts's header note. Not wired into any live path.

export type RiskBand = "MICRO" | "STANDARD" | "STRONG" | "AGGRESSIVE" | "MAXIMUM";

// Percent-of-bankroll bands (original master prompt, Section 15). Ranges
// are inclusive of their lower bound, exclusive of their upper — MAXIMUM's
// upper bound is a hard ceiling, never exceeded regardless of edge size.
const RISK_BANDS: { band: RiskBand; minPct: number; maxPct: number }[] = [
  { band: "MICRO", minPct: 0.005, maxPct: 0.01 },
  { band: "STANDARD", minPct: 0.01, maxPct: 0.03 },
  { band: "STRONG", minPct: 0.03, maxPct: 0.05 },
  { band: "AGGRESSIVE", minPct: 0.05, maxPct: 0.08 },
  { band: "MAXIMUM", minPct: 0.08, maxPct: 0.10 },
];

export function classifyRiskBand(edge: number, confidence: number): RiskBand {
  // A simple, provisional edge+confidence -> band mapping — meant to be
  // validated/re-tuned by the backtest engine, not treated as final.
  const score = edge * 100 * (confidence / 100); // rough combined signal
  if (score >= 6) return "MAXIMUM";
  if (score >= 4) return "AGGRESSIVE";
  if (score >= 2.5) return "STRONG";
  if (score >= 1) return "STANDARD";
  return "MICRO";
}

export function stakePercentForBand(band: RiskBand): number {
  const range = RISK_BANDS.find((r) => r.band === band);
  if (!range) throw new Error(`stakePercentForBand: unknown band ${band}`);
  return (range.minPct + range.maxPct) / 2; // midpoint of the band
}

export const MAX_SINGLE_STAKE_PERCENT = 0.10; // Section 15's absolute ceiling — never exceeded

export function applyStakeCap(rawStakePercent: number): number {
  return Math.min(rawStakePercent, MAX_SINGLE_STAKE_PERCENT);
}

/** Coverage-bet stake — deliberately separate from any value-bet band
 * (Section 31): a fixed small percent, never derived from edge/confidence
 * since a coverage bet has no real edge to size against. */
export const COVERAGE_STAKE_PERCENT = 0.0025;
