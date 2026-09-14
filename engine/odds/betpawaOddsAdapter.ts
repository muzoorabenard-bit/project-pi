import type { ApprovedMarket } from "../markets/whitelist.js";

/** Mirrors `bookmaker_odds_snapshots` rows exactly — BetPawa's own
 * market/selection vocabulary, not the engine's. */
export interface RawBookmakerOddsRow {
  market: string;
  selection: string;
  odds: number;
  source: string;
  captured_at: string;
}

export interface OddsQuote {
  odds: number;
  source: string;
  capturedAt: string;
}

/** Keyed by `${ApprovedMarket}:${selection}` in the engine's own vocabulary
 * (see rankMarkets.ts's selection strings — "HOME", "1X", "OVER", etc.). */
export type PricedOddsMap = Map<string, OddsQuote>;

function key(market: ApprovedMarket, selection: string): string {
  return `${market}:${selection}`;
}

/**
 * Translates one BetPawa (market, selection) pair into the engine's
 * (ApprovedMarket, selection) vocabulary, or null when BetPawa doesn't
 * offer an equivalent on the approved whitelist (Draw No Bet has no
 * whitelist counterpart today — see markets/whitelist.ts's own note on why
 * corners/exotic markets stay out entirely rather than half-mapped).
 */
export function translateBetpawaSelection(market: string, selection: string): { market: ApprovedMarket; selection: string } | null {
  switch (market) {
    case "1X2":
      if (selection === "1") return { market: "HOME_WIN", selection: "HOME" };
      if (selection === "X") return { market: "DRAW", selection: "DRAW" };
      if (selection === "2") return { market: "AWAY_WIN", selection: "AWAY" };
      return null;
    case "Double Chance":
      if (selection === "1X") return { market: "HOME_DRAW", selection: "1X" };
      if (selection === "12") return { market: "HOME_AWAY", selection: "12" };
      if (selection === "X2") return { market: "DRAW_AWAY", selection: "X2" };
      return null;
    case "BTTS":
      if (selection === "Yes") return { market: "BTTS_YES", selection: "YES" };
      if (selection === "No") return { market: "BTTS_NO", selection: "NO" };
      return null;
    case "Over/Under 2.5":
      if (selection === "Over 2.5") return { market: "OVER_2_5", selection: "OVER" };
      if (selection === "Under 2.5") return { market: "UNDER_2_5", selection: "UNDER" };
      return null;
    case "Draw No Bet":
      // Not on the approved whitelist (Phase 2 spec, Section 3) — captured
      // for completeness in the snapshot table, but never fed into ranking.
      return null;
    default:
      return null;
  }
}

/** Builds the full priced-odds lookup rankMarketCandidates consults, from
 * whatever raw BetPawa snapshot rows exist for one match. Rows with no
 * whitelist translation are silently skipped (not an error — Draw No Bet
 * rows are expected to appear here and go nowhere). */
export function buildPricedOddsMap(rows: RawBookmakerOddsRow[]): PricedOddsMap {
  const map: PricedOddsMap = new Map();
  for (const row of rows) {
    const translated = translateBetpawaSelection(row.market, row.selection);
    if (!translated) continue;
    map.set(key(translated.market, translated.selection), {
      odds: row.odds,
      source: row.source,
      capturedAt: row.captured_at,
    });
  }
  return map;
}

export function lookupPricedOdds(map: PricedOddsMap, market: ApprovedMarket, selection: string): OddsQuote | undefined {
  return map.get(key(market, selection));
}
