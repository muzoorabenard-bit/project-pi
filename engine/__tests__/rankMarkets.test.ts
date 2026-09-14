import { describe, expect, it } from "vitest";
import { rankMarketCandidates } from "../ranking/rankMarkets.js";
import { runEnsemble } from "../models/ensemble.js";
import { makeTeamFeatures } from "./fixtures.js";
import { isApprovedMarket } from "../markets/whitelist.js";
import { buildPricedOddsMap } from "../odds/betpawaOddsAdapter.js";

describe("rankMarketCandidates", () => {
  const home = makeTeamFeatures({}, true);
  const away = makeTeamFeatures({}, false);
  const probs = runEnsemble(home, away);

  it("generates only approved-market candidates", () => {
    const candidates = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 });
    for (const c of candidates) {
      expect(isApprovedMarket(c.market)).toBe(true);
    }
  });

  it("ranks by EV descending among priced candidates", () => {
    const candidates = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 });
    const priced = candidates.filter((c) => c.ev !== null);
    for (let i = 1; i < priced.length; i++) {
      expect(priced[i - 1]!.ev!).toBeGreaterThanOrEqual(priced[i]!.ev!);
    }
    // market_rank is assigned in the same order
    expect(candidates[0]!.marketRank).toBe(1);
    expect(candidates[candidates.length - 1]!.marketRank).toBe(candidates.length);
  });

  it("sorts unpriced candidates (no bookmaker odds) after every priced one", () => {
    const candidates = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 });
    const firstUnpricedIndex = candidates.findIndex((c) => c.ev === null);
    const lastPricedIndex = candidates.map((c) => c.ev !== null).lastIndexOf(true);
    if (firstUnpricedIndex !== -1 && lastPricedIndex !== -1) {
      expect(firstUnpricedIndex).toBeGreaterThan(lastPricedIndex);
    }
  });

  it("never fabricates odds for goals markets when none exist", () => {
    const candidates = rankMarketCandidates(probs, home, away, { home: null, draw: null, away: null });
    const btts = candidates.find((c) => c.market === "BTTS_YES");
    expect(btts?.bookmakerOdds).toBeNull();
    expect(btts?.edge).toBeNull();
    expect(btts?.ev).toBeNull();
    expect(btts?.dataQuality).toBe("INSUFFICIENT");
  });

  it("derives Double Chance odds only when all three 1X2 prices exist, and marks them as derived", () => {
    const withOdds = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 });
    const dc = withOdds.find((c) => c.market === "HOME_DRAW");
    expect(dc?.bookmakerOdds).not.toBeNull();
    expect(dc?.oddsSource).toBe("derived_1x2_combination");

    const withoutOdds = rankMarketCandidates(probs, home, away, { home: 1.8, draw: null, away: 4.2 });
    const dc2 = withoutOdds.find((c) => c.market === "HOME_DRAW");
    expect(dc2?.bookmakerOdds).toBeNull();
  });

  describe("real BetPawa quotes take priority over football-data.org/derived odds", () => {
    it("prefers a real BetPawa 1X2 quote over the football-data.org fallback", () => {
      const pricedOdds = buildPricedOddsMap([
        { market: "1X2", selection: "1", odds: 1.65, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
      ]);
      const candidates = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 }, pricedOdds);
      const homeWin = candidates.find((c) => c.market === "HOME_WIN");
      expect(homeWin?.bookmakerOdds).toBe(1.65); // BetPawa's price, not football-data.org's 1.8
      expect(homeWin?.oddsSource).toBe("betpawa");
    });

    it("prefers a real BetPawa Double Chance quote over the derived 1X2 combination", () => {
      const pricedOdds = buildPricedOddsMap([
        { market: "Double Chance", selection: "1X", odds: 1.2, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
      ]);
      const candidates = rankMarketCandidates(probs, home, away, { home: 1.8, draw: 3.6, away: 4.2 }, pricedOdds);
      const dc = candidates.find((c) => c.market === "HOME_DRAW");
      expect(dc?.bookmakerOdds).toBe(1.2);
      expect(dc?.oddsSource).toBe("betpawa");
    });

    it("prices goals markets for the first time when a real BetPawa quote exists", () => {
      const pricedOdds = buildPricedOddsMap([
        { market: "BTTS", selection: "Yes", odds: 1.95, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
        { market: "Over/Under 2.5", selection: "Over 2.5", odds: 1.85, source: "betpawa", captured_at: "2026-09-14T12:00:00Z" },
      ]);
      const candidates = rankMarketCandidates(probs, home, away, { home: null, draw: null, away: null }, pricedOdds);
      const btts = candidates.find((c) => c.market === "BTTS_YES");
      const over25 = candidates.find((c) => c.market === "OVER_2_5");
      expect(btts?.bookmakerOdds).toBe(1.95);
      expect(btts?.ev).not.toBeNull();
      expect(over25?.bookmakerOdds).toBe(1.85);
      expect(over25?.ev).not.toBeNull();
    });
  });
});
