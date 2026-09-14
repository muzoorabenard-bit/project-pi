import { describe, expect, it } from "vitest";
import { assertValidProbabilities, buildModelSignals, combineSignals, runEnsemble } from "../models/ensemble.js";
import { matchResultProbabilities, poissonPmf } from "../models/poisson.js";
import { makeTeamFeatures } from "./fixtures.js";

describe("poissonPmf", () => {
  it("sums to ~1 across k for a given lambda", () => {
    let sum = 0;
    for (let k = 0; k <= 30; k++) sum += poissonPmf(2.1, k);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("matchResultProbabilities", () => {
  it("produces a result distribution that sums to ~1", () => {
    const { pHome, pDraw, pAway } = matchResultProbabilities(1.5, 1.1);
    expect(pHome + pDraw + pAway).toBeCloseTo(1, 2);
  });

  it("favors the side with higher expected goals", () => {
    const { pHome, pAway } = matchResultProbabilities(2.2, 0.8);
    expect(pHome).toBeGreaterThan(pAway);
  });
});

describe("probability validation (Section 6: 'Validate this automatically')", () => {
  it("assertValidProbabilities throws when 1X2 doesn't sum to 1", () => {
    expect(() =>
      assertValidProbabilities({ pHome: 0.5, pDraw: 0.5, pAway: 0.5, pBtts: 0.5, pOver15: 0.5, pOver25: 0.5 }),
    ).toThrow();
  });

  it("assertValidProbabilities throws when any value is outside [0,1]", () => {
    expect(() =>
      assertValidProbabilities({ pHome: 1.2, pDraw: -0.1, pAway: -0.1, pBtts: 0.5, pOver15: 0.5, pOver25: 0.5 }),
    ).toThrow();
  });

  it("accepts a valid, normalized distribution", () => {
    expect(() =>
      assertValidProbabilities({ pHome: 0.5, pDraw: 0.3, pAway: 0.2, pBtts: 0.5, pOver15: 0.6, pOver25: 0.5 }),
    ).not.toThrow();
  });
});

describe("combineSignals", () => {
  it("weighted-averages multiple signals and re-normalizes 1X2 to sum to 1", () => {
    const combined = combineSignals([
      { name: "a", weight: 1, probabilities: { pHome: 0.6, pDraw: 0.2, pAway: 0.2, pBtts: 0.5, pOver15: 0.6, pOver25: 0.5 } },
      { name: "b", weight: 1, probabilities: { pHome: 0.4, pDraw: 0.3, pAway: 0.3, pBtts: 0.5, pOver15: 0.6, pOver25: 0.5 } },
    ]);
    expect(combined.pHome).toBeCloseTo(0.5, 2);
    expect(combined.pHome + combined.pDraw + combined.pAway).toBeCloseTo(1, 6);
  });

  it("throws when total weight is zero", () => {
    expect(() => combineSignals([{ name: "a", weight: 0, probabilities: { pHome: 0.5 } }])).toThrow();
  });
});

describe("runEnsemble", () => {
  it("produces four weighted signals and a validated combined result", () => {
    const home = makeTeamFeatures({}, true);
    const away = makeTeamFeatures({}, false);
    const signals = buildModelSignals(home, away);
    expect(signals.map((s) => s.name)).toEqual(["poisson", "recentForm", "teamStrength", "goalPattern"]);

    const combined = runEnsemble(home, away);
    expect(() => assertValidProbabilities(combined)).not.toThrow();
    expect(combined.pHome).toBeGreaterThan(0);
    expect(combined.pHome).toBeLessThan(1);
  });
});
