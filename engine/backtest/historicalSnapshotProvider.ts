import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ApprovedMarket } from "../markets/whitelist.js";
import type { Decision, TeamFeatures } from "../types.js";
import type { LeagueAverages } from "../models/leagueAverages.js";
import { checkLeakage } from "./leakageGuard.js";

export interface BacktestFilter {
  fromDate?: string; // inclusive, ISO date (YYYY-MM-DD)
  toDate?: string; // inclusive, ISO date
  league?: string;
  market?: ApprovedMarket;
}

export interface PredictionRecord {
  market: ApprovedMarket;
  selection: string;
  modelProbability: number;
  bookmakerOdds: number | null;
  impliedProbability: number | null;
  edge: number | null;
  ev: number | null;
  confidence: number;
  dataQuality: string;
  marketRank: number;
  oddsCapturedAt: string | null;
}

export interface BacktestableRecord {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime: string;
  homeScore: number;
  awayScore: number;
  featureSnapshot: {
    home: TeamFeatures;
    away: TeamFeatures;
    leagueAverages: LeagueAverages;
    capturedAt: string;
    modelVersion: string;
  };
  decision: { decision: Decision; predictionMarket: ApprovedMarket | null; predictionSelection: string | null; reason: string } | null;
  predictions: PredictionRecord[];
}

export interface RejectedRecord {
  matchId: string;
  reason: string;
}

export interface HistoricalDataset {
  backtestable: BacktestableRecord[];
  rejected: RejectedRecord[];
}

// ── Raw row shapes (exactly what's selected from Supabase) ─────────────────
interface RawMatchRow {
  id: string;
  home_team: string;
  away_team: string;
  league: string;
  kickoff_time: string;
  home_score: number | null;
  away_score: number | null;
}
interface RawSnapshotRow {
  match_id: string;
  captured_at: string;
  model_version: string;
  features: { home: TeamFeatures; away: TeamFeatures; leagueAverages?: LeagueAverages };
}
interface RawPredictionRow {
  match_id: string;
  market: string;
  selection: string;
  model_probability: number;
  bookmaker_odds: number | null;
  implied_probability: number | null;
  edge: number | null;
  ev: number | null;
  confidence: number;
  data_quality: string;
  market_rank: number;
  odds_captured_at: string | null;
}
interface RawDecisionRow {
  match_id: string;
  decision: string;
  market: string | null; // joined in from predictions via prediction_id, see fetch function
  selection: string | null;
  reason: string;
}

/**
 * Pure — assembles + leak-checks a dataset from already-fetched rows. Kept
 * separate from the Supabase I/O below so this logic is unit-testable
 * without a live database (see historicalSnapshotProvider.test.ts).
 * A match is excluded (never silently included) when it has no settled
 * score, no feature snapshot, or fails the leakage check on that snapshot
 * or on any of its priced predictions' odds.
 */
export function assembleHistoricalDataset(
  matches: RawMatchRow[],
  snapshotsByMatch: Map<string, RawSnapshotRow>,
  predictionsByMatch: Map<string, RawPredictionRow[]>,
  decisionsByMatch: Map<string, RawDecisionRow>,
): HistoricalDataset {
  const backtestable: BacktestableRecord[] = [];
  const rejected: RejectedRecord[] = [];

  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) {
      rejected.push({ matchId: match.id, reason: "match not yet settled (no final score)" });
      continue;
    }

    const snapshot = snapshotsByMatch.get(match.id);
    if (!snapshot) {
      rejected.push({ matchId: match.id, reason: "no feature_snapshots row for this match" });
      continue;
    }

    const snapshotLeak = checkLeakage({ kickoff: match.kickoff_time, featureSnapshotCapturedAt: snapshot.captured_at, oddsCapturedAt: null });
    if (snapshotLeak.status === "LEAKAGE_DETECTED") {
      rejected.push({ matchId: match.id, reason: `LEAKAGE_DETECTED: ${snapshotLeak.reason}` });
      continue;
    }

    const rawPredictions = predictionsByMatch.get(match.id) ?? [];
    const predictions: PredictionRecord[] = [];
    for (const p of rawPredictions) {
      const predictionLeak = checkLeakage({ kickoff: match.kickoff_time, featureSnapshotCapturedAt: snapshot.captured_at, oddsCapturedAt: p.odds_captured_at });
      if (predictionLeak.status === "LEAKAGE_DETECTED") {
        // Exclude just this one priced candidate, not the whole match — its
        // other candidates (and the match's model-diagnostic value) may
        // still be perfectly usable.
        continue;
      }
      predictions.push({
        market: p.market as ApprovedMarket,
        selection: p.selection,
        modelProbability: p.model_probability,
        bookmakerOdds: p.bookmaker_odds,
        impliedProbability: p.implied_probability,
        edge: p.edge,
        ev: p.ev,
        confidence: p.confidence,
        dataQuality: p.data_quality,
        marketRank: p.market_rank,
        oddsCapturedAt: p.odds_captured_at,
      });
    }

    const rawDecision = decisionsByMatch.get(match.id);

    backtestable.push({
      matchId: match.id,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      league: match.league,
      kickoffTime: match.kickoff_time,
      homeScore: match.home_score,
      awayScore: match.away_score,
      featureSnapshot: {
        home: snapshot.features.home,
        away: snapshot.features.away,
        leagueAverages: snapshot.features.leagueAverages ?? { avgGoalsScoredPerTeam: 1.4, avgGoalsConcededPerTeam: 1.4, sampleSize: 0 },
        capturedAt: snapshot.captured_at,
        modelVersion: snapshot.model_version,
      },
      decision: rawDecision
        ? {
            decision: rawDecision.decision as Decision,
            predictionMarket: (rawDecision.market as ApprovedMarket) ?? null,
            predictionSelection: rawDecision.selection ?? null,
            reason: rawDecision.reason,
          }
        : null,
      predictions,
    });
  }

  return { backtestable, rejected };
}

/**
 * Supabase I/O — fetches raw rows for the given filter and delegates to
 * assembleHistoricalDataset for all assembly/leakage logic.
 */
export async function fetchHistoricalDataset(supabase: SupabaseClient, filter: BacktestFilter = {}): Promise<HistoricalDataset> {
  let matchQuery = supabase.from("matches").select("id, home_team, away_team, league, kickoff_time, home_score, away_score").not("home_score", "is", null);
  if (filter.fromDate) matchQuery = matchQuery.gte("kickoff_time", `${filter.fromDate}T00:00:00Z`);
  if (filter.toDate) matchQuery = matchQuery.lte("kickoff_time", `${filter.toDate}T23:59:59Z`);
  if (filter.league) matchQuery = matchQuery.eq("league", filter.league);

  const { data: matches, error: matchError } = await matchQuery;
  if (matchError) throw matchError;
  const matchRows = (matches ?? []) as RawMatchRow[];
  if (matchRows.length === 0) return { backtestable: [], rejected: [] };

  const matchIds = matchRows.map((m) => m.id);

  const { data: snapshotRows, error: snapshotError } = await supabase
    .from("feature_snapshots")
    .select("match_id, captured_at, model_version, features")
    .in("match_id", matchIds)
    .order("captured_at", { ascending: false });
  if (snapshotError) throw snapshotError;

  // Latest snapshot per match — a match could have been analyzed more than
  // once (e.g. across model versions); the most recent is the one that
  // actually stood as this match's live prediction.
  const snapshotsByMatch = new Map<string, RawSnapshotRow>();
  for (const s of (snapshotRows ?? []) as RawSnapshotRow[]) {
    if (!snapshotsByMatch.has(s.match_id)) snapshotsByMatch.set(s.match_id, s);
  }

  let predictionQuery = supabase
    .from("predictions")
    .select("match_id, market, selection, model_probability, bookmaker_odds, implied_probability, edge, ev, confidence, data_quality, market_rank, odds_captured_at")
    .in("match_id", matchIds);
  if (filter.market) predictionQuery = predictionQuery.eq("market", filter.market);
  const { data: predictionRows, error: predictionError } = await predictionQuery;
  if (predictionError) throw predictionError;

  const predictionsByMatch = new Map<string, RawPredictionRow[]>();
  for (const p of (predictionRows ?? []) as RawPredictionRow[]) {
    const list = predictionsByMatch.get(p.match_id) ?? [];
    list.push(p);
    predictionsByMatch.set(p.match_id, list);
  }

  const { data: decisionRows, error: decisionError } = await supabase
    .from("betting_decisions")
    .select("match_id, decision, reason, predictions(market, selection)")
    .in("match_id", matchIds);
  if (decisionError) throw decisionError;

  const decisionsByMatch = new Map<string, RawDecisionRow>();
  for (const d of decisionRows ?? []) {
    const joined = d as unknown as { match_id: string; decision: string; reason: string; predictions: { market: string; selection: string } | null };
    decisionsByMatch.set(joined.match_id, {
      match_id: joined.match_id,
      decision: joined.decision,
      reason: joined.reason,
      market: joined.predictions?.market ?? null,
      selection: joined.predictions?.selection ?? null,
    });
  }

  return assembleHistoricalDataset(matchRows, snapshotsByMatch, predictionsByMatch, decisionsByMatch);
}

export function createBacktestSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key);
}
