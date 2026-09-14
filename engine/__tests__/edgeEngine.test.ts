import { describe, expect, it } from "vitest";
import { computeEdgeAndEv, devigProbabilities, edge, expectedValue, impliedProbability } from "../edge/edgeEngine.js";

describe("impliedProbability", () => {
  it("computes 1/odds", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5);
    expect(impliedProbability(1.5)).toBeCloseTo(0.6667, 3);
    expect(impliedProbability(3)).toBeCloseTo(0.3333, 3);
  });

  it("rejects odds <= 1", () => {
    expect(() => impliedProbability(1)).toThrow();
    expect(() => impliedProbability(0.5)).toThrow();
  });
});

describe("edge", () => {
  it("is modelProbability - impliedProbability, and can be negative", () => {
    expect(edge(0.6, 0.5)).toBeCloseTo(0.1);
    expect(edge(0.4, 0.5)).toBeCloseTo(-0.1);
  });
});

describe("expectedValue", () => {
  it("matches the spec's worked example: p=0.60, odds=2.00 -> EV=+0.20", () => {
    expect(expectedValue(0.6, 2.0)).toBeCloseTo(0.2);
  });

  it("is negative when the price doesn't cover the probability", () => {
    expect(expectedValue(0.4, 2.0)).toBeCloseTo(-0.2);
  });
});

describe("computeEdgeAndEv", () => {
  it("returns implied probability, edge, and EV together", () => {
    const result = computeEdgeAndEv(0.6, 2.0);
    expect(result.impliedProbability).toBeCloseTo(0.5);
    expect(result.edge).toBeCloseTo(0.1);
    expect(result.ev).toBeCloseTo(0.2);
  });
});

describe("devigProbabilities", () => {
  it("normalizes a set of implied probabilities to sum to 1", () => {
    // odds 2.00/3.50/4.00 -> raw implied 0.5 + 0.2857 + 0.25 = 1.0357 (3.57% overround)
    const raw = [0.5, 1 / 3.5, 0.25];
    const fair = devigProbabilities(raw);
    const sum = fair.reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
    // relative ordering is preserved
    expect(fair[0]!).toBeGreaterThan(fair[1]!);
    expect(fair[1]!).toBeGreaterThan(fair[2]!);
  });
});
