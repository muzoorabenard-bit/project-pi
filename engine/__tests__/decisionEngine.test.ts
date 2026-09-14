import { describe, expect, it } from "vitest";
import { decideBet } from "../decision/decisionEngine.js";
import type { RankedPrediction } from "../types.js";

function candidate(overrides: Partial<RankedPrediction>): RankedPrediction {
  return {
    market: "HOME_WIN",
    selection: "HOME",
    modelProbability: 0.6,
    impliedProbability: 0.5,
    bookmakerOdds: 2.0,
    oddsSource: "football-data.org",
    oddsCapturedAt: new Date().toISOString(),
    edge: 0.1,
    ev: 0.2,
    confidence: 80,
    dataQuality: "HIGH",
    marketRank: 1,
    ...overrides,
  };
}

describe("decideBet", () => {
  it("returns VALUE_BET when edge and confidence both clear the thresholds", () => {
    const result = decideBet([candidate({})]);
    expect(result.decision).toBe("VALUE_BET");
    expect(result.predictionMarket).toBe("HOME_WIN");
    expect(result.predictionSelection).toBe("HOME");
  });

  it("returns NO_EDGE when edge is below the minimum", () => {
    const result = decideBet([candidate({ edge: 0.01, ev: 0.02 })]);
    expect(result.decision).toBe("NO_EDGE");
    expect(result.reason).toMatch(/edge/i);
  });

  it("returns NO_EDGE when confidence is below the minimum, even with strong edge", () => {
    const result = decideBet([candidate({ confidence: 40 })]);
    expect(result.decision).toBe("NO_EDGE");
    expect(result.reason).toMatch(/confidence/i);
  });

  it("returns NO_EDGE (not VALUE_BET) when the top candidate has no odds", () => {
    const result = decideBet([candidate({ edge: null, ev: null, bookmakerOdds: null })]);
    expect(result.decision).toBe("NO_EDGE");
  });

  it("returns NO_EDGE when no candidates exist at all", () => {
    const result = decideBet([]);
    expect(result.decision).toBe("NO_EDGE");
    expect(result.predictionMarket).toBeNull();
  });

  it("never disguises a no-edge fixture as a VALUE_BET", () => {
    const noEdgeCandidates = [candidate({ edge: 0, ev: -0.02, confidence: 50 })];
    const result = decideBet(noEdgeCandidates);
    expect(result.decision).not.toBe("VALUE_BET");
  });

  describe("coverage classification (Section 9/31)", () => {
    it("stays NO_EDGE when coverage staking is disabled (the default)", () => {
      const result = decideBet([candidate({ edge: 0.01, ev: -0.01 })], {
        minimumEdge: 0.03,
        minimumConfidence: 65,
        coverageStakeEnabled: false,
      });
      expect(result.decision).toBe("NO_EDGE");
    });

    it("becomes COVERAGE_BET, distinctly labeled, when coverage staking is explicitly enabled", () => {
      const result = decideBet([candidate({ edge: 0.01, ev: -0.01 })], {
        minimumEdge: 0.03,
        minimumConfidence: 65,
        coverageStakeEnabled: true,
      });
      expect(result.decision).toBe("COVERAGE_BET");
      expect(result.reason).toMatch(/not a value bet/i);
    });

    it("a COVERAGE_BET is never also classified VALUE_BET for the same input", () => {
      const thresholds = { minimumEdge: 0.03, minimumConfidence: 65, coverageStakeEnabled: true };
      const weakCandidate = candidate({ edge: 0.01, ev: -0.01 });
      const result = decideBet([weakCandidate], thresholds);
      expect(result.decision).toBe("COVERAGE_BET");
      expect(result.decision).not.toBe("VALUE_BET");
    });
  });
});
