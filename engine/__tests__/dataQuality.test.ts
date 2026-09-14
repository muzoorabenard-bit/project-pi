import { describe, expect, it } from "vitest";
import { assessDataQuality } from "../dataQuality/dataQuality.js";
import { makeSparseTeamFeatures, makeTeamFeatures } from "./fixtures.js";

describe("assessDataQuality", () => {
  it("is INSUFFICIENT whenever there are no bookmaker odds, regardless of how good the stats are", () => {
    const home = makeTeamFeatures({}, true);
    const away = makeTeamFeatures({}, false);
    const result = assessDataQuality(home, away, false);
    expect(result.quality).toBe("INSUFFICIENT");
    expect(result.reasons).toContain("no bookmaker odds available yet");
  });

  it("is HIGH when both teams have complete stats and odds exist", () => {
    const home = makeTeamFeatures({}, true);
    const away = makeTeamFeatures({}, false);
    const result = assessDataQuality(home, away, true);
    expect(result.quality).toBe("HIGH");
    expect(result.reasons).toHaveLength(0);
  });

  it("is LOW when core stats are missing for multiple fields even with odds present", () => {
    const home = makeSparseTeamFeatures(true);
    const away = makeSparseTeamFeatures(false);
    const result = assessDataQuality(home, away, true);
    expect(result.quality).toBe("LOW");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("never invents a reason — every flagged gap corresponds to an actual null field", () => {
    const home = makeSparseTeamFeatures(true);
    const away = makeTeamFeatures({}, false);
    const result = assessDataQuality(home, away, true);
    expect(result.reasons.some((r) => r.includes("home team"))).toBe(true);
  });
});
