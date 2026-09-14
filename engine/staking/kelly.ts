// FOUNDATION ONLY — Phase 2 spec, Section 14: "Prepare the staking interface
// but do NOT activate live betting." Nothing in this file is imported by
// ai-bet-ug's execution path (src/guardrails/kelly.ts there is untouched by
// this phase and remains what actually runs in production).

/** Full Kelly fraction: f = (b*p - q) / b, where b = odds - 1. Can be
 * negative (no edge) or > 1 in degenerate inputs — callers must clamp. */
export function kellyFraction(modelProbability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const p = modelProbability;
  const q = 1 - p;
  return (b * p - q) / b;
}
