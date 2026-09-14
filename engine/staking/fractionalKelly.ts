// FOUNDATION ONLY — see kelly.ts's header note. Not wired into any live path.

import { kellyFraction } from "./kelly.js";

export interface FractionalKellyInput {
  modelProbability: number;
  decimalOdds: number;
  bankroll: number;
  kellyFractionMultiplier: number; // e.g. 0.25 for quarter-Kelly — never 1.0 (full Kelly) by default, per spec Section 16
  maxSingleStakePercent: number; // hard cap, e.g. 0.10 = 10% of bankroll
}

export interface FractionalKellyResult {
  rawKellyFraction: number;
  appliedFraction: number; // after multiplier + hard cap
  stake: number;
}

/**
 * Never returns a negative stake (no edge => stake 0, not a "lay" position —
 * this system only ever backs outcomes). Always respects
 * `maxSingleStakePercent` even if the raw fractional-Kelly number would
 * exceed it (Section 15's absolute cap, Section 16's "never full Kelly").
 */
export function computeFractionalKellyStake(input: FractionalKellyInput): FractionalKellyResult {
  const raw = kellyFraction(input.modelProbability, input.decimalOdds);
  const scaled = Math.max(0, raw * input.kellyFractionMultiplier);
  const applied = Math.min(scaled, input.maxSingleStakePercent);
  return {
    rawKellyFraction: raw,
    appliedFraction: applied,
    stake: +(applied * input.bankroll).toFixed(2),
  };
}
