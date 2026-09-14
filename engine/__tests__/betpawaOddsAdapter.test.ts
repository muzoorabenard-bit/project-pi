import { describe, expect, it } from "vitest";
import { buildPricedOddsMap, lookupPricedOdds, translateBetpawaSelection } from "../odds/betpawaOddsAdapter.js";

describe("translateBetpawaSelection", () => {
  it("translates all 4 whitelisted BetPawa markets to engine vocabulary", () => {
    expect(translateBetpawaSelection("1X2", "1")).toEqual({ market: "HOME_WIN", selection: "HOME" });
    expect(translateBetpawaSelection("1X2", "X")).toEqual({ market: "DRAW", selection: "DRAW" });
    expect(translateBetpawaSelection("1X2", "2")).toEqual({ market: "AWAY_WIN", selection: "AWAY" });
    expect(translateBetpawaSelection("Double Chance", "1X")).toEqual({ market: "HOME_DRAW", selection: "1X" });
    expect(translateBetpawaSelection("Double Chance", "12")).toEqual({ market: "HOME_AWAY", selection: "12" });
    expect(translateBetpawaSelection("Double Chance", "X2")).toEqual({ market: "DRAW_AWAY", selection: "X2" });
    expect(translateBetpawaSelection("BTTS", "Yes")).toEqual({ market: "BTTS_YES", selection: "YES" });
    expect(translateBetpawaSelection("BTTS", "No")).toEqual({ market: "BTTS_NO", selection: "NO" });
    expect(translateBetpawaSelection("Over/Under 2.5", "Over 2.5")).toEqual({ market: "OVER_2_5", selection: "OVER" });
    expect(translateBetpawaSelection("Over/Under 2.5", "Under 2.5")).toEqual({ market: "UNDER_2_5", selection: "UNDER" });
  });

  it("returns null for Draw No Bet — no whitelist counterpart", () => {
    expect(translateBetpawaSelection("Draw No Bet", "1")).toBeNull();
    expect(translateBetpawaSelection("Draw No Bet", "2")).toBeNull();
  });

  it("returns null for unrecognized markets/selections rather than guessing", () => {
    expect(translateBetpawaSelection("Correct Score", "1-0")).toBeNull();
    expect(translateBetpawaSelection("1X2", "unexpected-label")).toBeNull();
  });
});

describe("buildPricedOddsMap / lookupPricedOdds", () => {
  it("builds a lookup map keyed by engine market+selection, skipping untranslatable rows", () => {
    const rows = [
      { market: "1X2", selection: "1", odds: 1.8, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
      { market: "BTTS", selection: "Yes", odds: 1.95, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
      { market: "Draw No Bet", selection: "1", odds: 1.3, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
    ];
    const map = buildPricedOddsMap(rows);
    expect(lookupPricedOdds(map, "HOME_WIN", "HOME")?.odds).toBe(1.8);
    expect(lookupPricedOdds(map, "BTTS_YES", "YES")?.odds).toBe(1.95);
    expect(map.size).toBe(2); // Draw No Bet row silently dropped, not an error
  });

  it("returns undefined for a market/selection with no captured quote", () => {
    const map = buildPricedOddsMap([]);
    expect(lookupPricedOdds(map, "HOME_WIN", "HOME")).toBeUndefined();
  });
});
