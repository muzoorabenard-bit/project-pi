import { describe, expect, it } from "vitest";
import { kellyFraction } from "../staking/kelly.js";
import { computeFractionalKellyStake } from "../staking/fractionalKelly.js";
import { applyStakeCap, MAX_SINGLE_STAKE_PERCENT } from "../staking/stakeCaps.js";

describe("kellyFraction", () => {
  it("returns 0 when there is no edge", () => {
    // p=0.5, odds=2.0 -> b=1, f=(1*0.5-0.5)/1=0
    expect(kellyFraction(0.5, 2.0)).toBeCloseTo(0);
  });

  it("returns a positive fraction when there is edge", () => {
    // p=0.6, odds=2.0 -> b=1, f=(1*0.6-0.4)/1=0.2
    expect(kellyFraction(0.6, 2.0)).toBeCloseTo(0.2);
  });

  it("returns negative for a bad bet (no clamping at this layer)", () => {
    expect(kellyFraction(0.3, 2.0)).toBeLessThan(0);
  });

  it("treats odds <= 1 as no bet", () => {
    expect(kellyFraction(0.9, 1)).toBe(0);
  });
});

describe("computeFractionalKellyStake", () => {
  it("applies the fraction multiplier (never full Kelly)", () => {
    const result = computeFractionalKellyStake({
      modelProbability: 0.6,
      decimalOdds: 2.0,
      bankroll: 50000,
      kellyFractionMultiplier: 0.25,
      maxSingleStakePercent: 0.10,
    });
    expect(result.rawKellyFraction).toBeCloseTo(0.2);
    expect(result.appliedFraction).toBeCloseTo(0.05); // 0.2 * 0.25
    expect(result.stake).toBeCloseTo(2500); // 5% of 50000
  });

  it("never returns a negative stake when there's no edge", () => {
    const result = computeFractionalKellyStake({
      modelProbability: 0.3,
      decimalOdds: 2.0,
      bankroll: 50000,
      kellyFractionMultiplier: 0.25,
      maxSingleStakePercent: 0.10,
    });
    expect(result.stake).toBe(0);
  });

  it("never exceeds maxSingleStakePercent even with a huge edge", () => {
    const result = computeFractionalKellyStake({
      modelProbability: 0.95,
      decimalOdds: 5.0,
      bankroll: 50000,
      kellyFractionMultiplier: 1.0, // even at full-Kelly multiplier
      maxSingleStakePercent: 0.10,
    });
    expect(result.appliedFraction).toBeLessThanOrEqual(0.10);
  });
});

describe("applyStakeCap", () => {
  it("caps at the absolute maximum single-stake percent", () => {
    expect(applyStakeCap(0.5)).toBe(MAX_SINGLE_STAKE_PERCENT);
    expect(applyStakeCap(0.03)).toBe(0.03);
  });
});
