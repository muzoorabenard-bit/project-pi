import { describe, expect, it } from "vitest";
import { APPROVED_MARKETS, assertApprovedMarket, isApprovedMarket } from "../markets/whitelist.js";

describe("market whitelist", () => {
  it("accepts every approved market", () => {
    for (const market of APPROVED_MARKETS) {
      expect(isApprovedMarket(market)).toBe(true);
    }
  });

  it("rejects forbidden markets (Section 5's list)", () => {
    for (const forbidden of ["CORRECT_SCORE", "ANYTIME_SCORER", "CARDS", "ASIAN_HANDICAP", "HT_FT", "TOTAL_CORNERS"]) {
      expect(isApprovedMarket(forbidden)).toBe(false);
    }
  });

  it("assertApprovedMarket throws on an unapproved market", () => {
    expect(() => assertApprovedMarket("CORRECT_SCORE")).toThrow();
  });

  it("assertApprovedMarket does not throw on an approved market", () => {
    expect(() => assertApprovedMarket("HOME_WIN")).not.toThrow();
  });
});
