// The complete approved-market universe (Phase 2 spec, Section 3). Enforced
// in code — nothing outside this list may ever appear in a `predictions`
// row. Corners are intentionally NOT included: no reliable data source
// exists yet (see PHASE_2_CODEBASE_ASSESSMENT.md, section 11) — they stay
// out of the whitelist entirely rather than being half-wired and disabled,
// so there's no risk of a STAGED market silently leaking into a candidate
// list through a missed guard.

export const APPROVED_MARKETS = [
  "HOME_WIN",
  "DRAW",
  "AWAY_WIN",
  "HOME_DRAW",
  "HOME_AWAY",
  "DRAW_AWAY",
  "OVER_1_5",
  "OVER_2_5",
  "UNDER_2_5",
  "BTTS_YES",
  "BTTS_NO",
  "TEAM_GOALS",
] as const;

export type ApprovedMarket = (typeof APPROVED_MARKETS)[number];

const APPROVED_MARKET_SET: ReadonlySet<string> = new Set(APPROVED_MARKETS);

export function isApprovedMarket(market: string): market is ApprovedMarket {
  return APPROVED_MARKET_SET.has(market);
}

export function assertApprovedMarket(market: string): asserts market is ApprovedMarket {
  if (!isApprovedMarket(market)) {
    throw new Error(
      `market "${market}" is not in the approved whitelist (${APPROVED_MARKETS.join(", ")})`,
    );
  }
}
