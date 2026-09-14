import type { ApprovedMarket } from "../markets/whitelist.js";
import type { MarketCandidate, ModelProbabilities, RankedPrediction, TeamFeatures } from "../types.js";
import { computeEdgeAndEv } from "../edge/edgeEngine.js";
import { assessDataQuality } from "../dataQuality/dataQuality.js";
import { expectedGoals, poissonPmf } from "../models/poisson.js";
import { attackStrength, defenseStrength, FALLBACK_LEAGUE_AVERAGES, type LeagueAverages } from "../models/leagueAverages.js";
import { lookupPricedOdds, type PricedOddsMap } from "../odds/betpawaOddsAdapter.js";

/** football-data.org's 1X2 prices — the only fallback odds source when no
 * real BetPawa quote exists yet (see PricedOddsMap, engine/odds/
 * betpawaOddsAdapter.ts, which now takes priority over this). */
export interface MatchOdds {
  home: number | null;
  draw: number | null;
  away: number | null;
}

interface ResolvedOdds {
  odds: number | null;
  source: string | null;
  capturedAt: string | null;
}

const NO_ODDS: ResolvedOdds = { odds: null, source: null, capturedAt: null };

/**
 * Real BetPawa quotes always win when present — they're the actual price
 * this system would bet at, not a third-party feed or an algebraic guess.
 * Falls back to `fallback` (and marks it accordingly) only when no live
 * quote exists for this exact market+selection.
 */
function resolveOdds(
  pricedOdds: PricedOddsMap | undefined,
  market: ApprovedMarket,
  selection: string,
  fallback: ResolvedOdds,
): ResolvedOdds {
  const quote = pricedOdds && lookupPricedOdds(pricedOdds, market, selection);
  if (quote) {
    return { odds: quote.odds, source: quote.source, capturedAt: quote.capturedAt };
  }
  return fallback;
}

interface SelectionSpec {
  market: ApprovedMarket;
  selection: string;
  probability: number;
  resolved: ResolvedOdds;
}

function safeOdds(prob: number): number | null {
  return prob > 0 ? +(1 / prob).toFixed(3) : null;
}

/** Builds one SelectionSpec per approved market from the ensemble output +
 * whatever real odds exist (BetPawa first, football-data.org 1X2 / derived
 * Double Chance as fallback). Team Goals reuses the same Poisson primitives
 * the main ensemble signal uses (expectedGoals/poissonPmf), not a
 * duplicated model — "will this specific team score at least once" has no
 * home/away/BTTS shortcut, it needs its own single-team Poisson query. */
function buildSelectionSpecs(
  probs: ModelProbabilities,
  home: TeamFeatures,
  away: TeamFeatures,
  fallbackOdds: MatchOdds,
  pricedOdds: PricedOddsMap | undefined,
  league: LeagueAverages,
): SelectionSpec[] {
  const specs: SelectionSpec[] = [];
  const nowIso = new Date().toISOString();

  const fdSource = (odds: number | null): ResolvedOdds =>
    odds === null ? NO_ODDS : { odds, source: "football-data.org", capturedAt: nowIso };

  specs.push({ market: "HOME_WIN", selection: "HOME", probability: probs.pHome, resolved: resolveOdds(pricedOdds, "HOME_WIN", "HOME", fdSource(fallbackOdds.home)) });
  specs.push({ market: "DRAW", selection: "DRAW", probability: probs.pDraw, resolved: resolveOdds(pricedOdds, "DRAW", "DRAW", fdSource(fallbackOdds.draw)) });
  specs.push({ market: "AWAY_WIN", selection: "AWAY", probability: probs.pAway, resolved: resolveOdds(pricedOdds, "AWAY_WIN", "AWAY", fdSource(fallbackOdds.away)) });

  // Double Chance fallback — algebraically combined from real 1X2 prices
  // when all three exist and no direct BetPawa Double Chance quote is
  // available. Approximate (compounds each side's overround) but grounded
  // in real market prices, unlike a bare model-only guess.
  const haveAll1x2Odds = fallbackOdds.home !== null && fallbackOdds.draw !== null && fallbackOdds.away !== null;
  let derivedHomeDraw: ResolvedOdds = NO_ODDS;
  let derivedHomeAway: ResolvedOdds = NO_ODDS;
  let derivedDrawAway: ResolvedOdds = NO_ODDS;
  if (haveAll1x2Odds) {
    const iHome = 1 / (fallbackOdds.home as number);
    const iDraw = 1 / (fallbackOdds.draw as number);
    const iAway = 1 / (fallbackOdds.away as number);
    derivedHomeDraw = { odds: safeOdds(iHome + iDraw), source: "derived_1x2_combination", capturedAt: nowIso };
    derivedHomeAway = { odds: safeOdds(iHome + iAway), source: "derived_1x2_combination", capturedAt: nowIso };
    derivedDrawAway = { odds: safeOdds(iDraw + iAway), source: "derived_1x2_combination", capturedAt: nowIso };
  }
  specs.push({ market: "HOME_DRAW", selection: "1X", probability: probs.pHome + probs.pDraw, resolved: resolveOdds(pricedOdds, "HOME_DRAW", "1X", derivedHomeDraw) });
  specs.push({ market: "HOME_AWAY", selection: "12", probability: probs.pHome + probs.pAway, resolved: resolveOdds(pricedOdds, "HOME_AWAY", "12", derivedHomeAway) });
  specs.push({ market: "DRAW_AWAY", selection: "X2", probability: probs.pDraw + probs.pAway, resolved: resolveOdds(pricedOdds, "DRAW_AWAY", "X2", derivedDrawAway) });

  // Goals markets — only ever priced via a real BetPawa quote; no
  // football-data.org fallback exists for these.
  specs.push({ market: "OVER_1_5", selection: "OVER", probability: probs.pOver15, resolved: resolveOdds(pricedOdds, "OVER_1_5", "OVER", NO_ODDS) });
  specs.push({ market: "OVER_2_5", selection: "OVER", probability: probs.pOver25, resolved: resolveOdds(pricedOdds, "OVER_2_5", "OVER", NO_ODDS) });
  specs.push({ market: "UNDER_2_5", selection: "UNDER", probability: 1 - probs.pOver25, resolved: resolveOdds(pricedOdds, "UNDER_2_5", "UNDER", NO_ODDS) });
  specs.push({ market: "BTTS_YES", selection: "YES", probability: probs.pBtts, resolved: resolveOdds(pricedOdds, "BTTS_YES", "YES", NO_ODDS) });
  specs.push({ market: "BTTS_NO", selection: "NO", probability: 1 - probs.pBtts, resolved: resolveOdds(pricedOdds, "BTTS_NO", "NO", NO_ODDS) });

  // Team Goals — "will this team score at least once", from the same
  // strength-adjusted expectedGoals() inputs the ensemble's poisson signal
  // already derives (see leagueAverages.ts — raw per-team averages
  // overstate a weak attack against a strong defense and vice versa).
  // No BetPawa market maps to this today (see betpawaOddsAdapter.ts) — it
  // stays permanently unpriced until/unless one is added.
  const homeAttAvg = home.home?.goalsScoredAvg ?? home.overall.goalsScoredAvg ?? league.avgGoalsScoredPerTeam;
  const awayDefAvg = away.away?.goalsConcededAvg ?? away.overall.goalsConcededAvg ?? league.avgGoalsConcededPerTeam;
  const awayAttAvg = away.away?.goalsScoredAvg ?? away.overall.goalsScoredAvg ?? league.avgGoalsScoredPerTeam;
  const homeDefAvg = home.home?.goalsConcededAvg ?? home.overall.goalsConcededAvg ?? league.avgGoalsConcededPerTeam;
  const homeXg = expectedGoals(attackStrength(homeAttAvg, league), defenseStrength(awayDefAvg, league), league.avgGoalsScoredPerTeam);
  const awayXg = expectedGoals(attackStrength(awayAttAvg, league), defenseStrength(homeDefAvg, league), league.avgGoalsScoredPerTeam);
  specs.push({ market: "TEAM_GOALS", selection: "HOME_OVER_0_5", probability: 1 - poissonPmf(homeXg, 0), resolved: NO_ODDS });
  specs.push({ market: "TEAM_GOALS", selection: "AWAY_OVER_0_5", probability: 1 - poissonPmf(awayXg, 0), resolved: NO_ODDS });

  return specs;
}

const CONFIDENCE_BASE = 40;

/** 0-100, distinct from probability (Section 25 of the original master
 * prompt / Phase 2 spec's data-quality section) — built from sample size
 * and data completeness, not from how extreme the probability itself is. */
function computeConfidence(home: TeamFeatures, away: TeamFeatures, hasOdds: boolean): number {
  let score = CONFIDENCE_BASE;
  score += Math.min(20, home.overall.played * 2);
  score += Math.min(20, away.overall.played * 2);
  if (home.context.leaguePosition !== null) score += 5;
  if (away.context.leaguePosition !== null) score += 5;
  if (hasOdds) score += 10;
  return Math.max(0, Math.min(100, score));
}

/**
 * Generates every approved-market candidate for one fixture, prices each
 * one, and ranks by EV — the core replacement for analyze-matches' old
 * single-pick heuristic (Phase 2 spec, Section 8). Candidates with no
 * bookmaker odds get edge=null/ev=null and rank last, never zero/fabricated.
 * `pricedOdds` (real, live BetPawa quotes) always takes priority over
 * `fallbackOdds` (football-data.org 1X2 / derived Double Chance) when both
 * exist for the same candidate.
 */
export function rankMarketCandidates(
  probs: ModelProbabilities,
  home: TeamFeatures,
  away: TeamFeatures,
  fallbackOdds: MatchOdds,
  pricedOdds?: PricedOddsMap,
  league: LeagueAverages = FALLBACK_LEAGUE_AVERAGES,
): RankedPrediction[] {
  const specs = buildSelectionSpecs(probs, home, away, fallbackOdds, pricedOdds, league);
  const hasAnyOdds = specs.some((s) => s.resolved.odds !== null);
  const confidence = computeConfidence(home, away, hasAnyOdds);

  const candidates: MarketCandidate[] = specs.map((spec) => {
    const dq = assessDataQuality(home, away, spec.resolved.odds !== null);
    const priced = spec.resolved.odds !== null ? computeEdgeAndEv(spec.probability, spec.resolved.odds) : null;

    return {
      market: spec.market,
      selection: spec.selection,
      modelProbability: spec.probability,
      impliedProbability: priced?.impliedProbability ?? null,
      bookmakerOdds: spec.resolved.odds,
      oddsSource: spec.resolved.source,
      oddsCapturedAt: spec.resolved.capturedAt,
      edge: priced?.edge ?? null,
      ev: priced?.ev ?? null,
      confidence,
      dataQuality: dq.quality,
    };
  });

  // Rank by EV descending; candidates with no EV (no odds) sort after every
  // priced candidate, ordered among themselves by model probability as a
  // secondary, purely informational signal (Section 8/36: confidence then
  // data quality as tiebreaks).
  const sorted = [...candidates].sort((a, b) => {
    if (a.ev !== null && b.ev !== null) return b.ev - a.ev;
    if (a.ev !== null) return -1;
    if (b.ev !== null) return 1;
    return b.modelProbability - a.modelProbability;
  });

  return sorted.map((c, i) => ({ ...c, marketRank: i + 1 }));
}
