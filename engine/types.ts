import type { ApprovedMarket } from "./markets/whitelist.js";

export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
export type Decision = "VALUE_BET" | "NO_EDGE" | "COVERAGE_BET";

export interface Fixture {
  id: string; // matches.id (uuid)
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime: string; // ISO timestamp
}

/** Every field that can legitimately be missing is null, never guessed. */
export interface FormStats {
  asOf: string; // ISO timestamp this snapshot was computed as-of
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScoredAvg: number | null;
  goalsConcededAvg: number | null;
  bttsRate: number | null;
  over15Rate: number | null;
  over25Rate: number | null;
  under25Rate: number | null;
  cleanSheets: number | null;
  failedToScore: number | null;
}

export interface HomeAwayStats {
  asOf: string;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goalsScoredAvg: number | null;
  goalsConcededAvg: number | null;
  cleanSheetStreak: number | null;
  unbeatenStreak: number | null;
}

export interface ContextStats {
  asOf: string;
  leaguePosition: number | null;
  leaguePoints: number | null;
  totalTeams: number | null;
  gapToRelegation: number | null;
  gapToTop4: number | null;
  restDays: number | null;
  fixtureCongestion: boolean | null; // true = 3+ matches in last ~10 days, when known
}

export interface H2HStats {
  asOf: string;
  matchesConsidered: number; // how many recent meetings were actually found
  homeWins: number;
  draws: number;
  awayWins: number;
  avgTotalGoals: number | null;
}

export interface TeamFeatures {
  team: string;
  overall: FormStats;
  home: HomeAwayStats | null; // null when this team is being evaluated as the away side
  away: HomeAwayStats | null; // null when this team is being evaluated as the home side
  context: ContextStats;
}

export interface FeatureSnapshot {
  fixture: Fixture;
  modelVersion: string;
  capturedAt: string;
  home: TeamFeatures;
  away: TeamFeatures;
  h2h: H2HStats;
}

export type MatchClassification =
  | "STRONG_FAVOURITE"
  | "BALANCED"
  | "DRAW_CANDIDATE"
  | "GOAL_RICH"
  | "LOW_SCORING"
  | "BTTS_CANDIDATE"
  | "OVER_CANDIDATE"
  | "UNDER_CANDIDATE";

export interface ModelProbabilities {
  // 1X2 — always present, always sums to ~1
  pHome: number;
  pDraw: number;
  pAway: number;
  // goals markets
  pBtts: number;
  pOver15: number;
  pOver25: number;
}

export interface ModelSignal {
  name: string;
  weight: number;
  probabilities: Partial<ModelProbabilities>;
}

export interface MarketCandidate {
  market: ApprovedMarket;
  selection: string;
  modelProbability: number;
  impliedProbability: number | null;
  bookmakerOdds: number | null;
  oddsSource: string | null;
  oddsCapturedAt: string | null;
  edge: number | null;
  ev: number | null;
  confidence: number; // 0-100
  dataQuality: DataQuality;
}

export interface RankedPrediction extends MarketCandidate {
  marketRank: number; // 1 = best EV for this match
}

export interface BettingDecisionResult {
  decision: Decision;
  reason: string;
  predictionMarket: ApprovedMarket | null;
  predictionSelection: string | null;
}
