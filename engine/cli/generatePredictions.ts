import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildTeamFeatures, emptyTeamStatsRow, type TeamStatsRow } from "../features/featureEngine.js";
import { computeH2H, type PastMeeting } from "../features/h2h.js";
import { runEnsemble } from "../models/ensemble.js";
import { computeLeagueAverages, type LeagueAverages } from "../models/leagueAverages.js";
import { rankMarketCandidates, type MatchOdds } from "../ranking/rankMarkets.js";
import { buildPricedOddsMap, type RawBookmakerOddsRow } from "../odds/betpawaOddsAdapter.js";
import { decideBet } from "../decision/decisionEngine.js";
import type { TeamFeatures } from "../types.js";

// Does NOT read or write `recommendations`/`recommended_bets` — this is an
// entirely separate, additive pipeline for review/backtesting (see
// PHASE_2_CODEBASE_ASSESSMENT.md and the Phase 2 plan). analyze-matches'
// existing single-pick production flow is untouched by running this.

config();

// Bumped from phase2-v1: the Poisson signal now uses league-normalized
// attack/defense strength instead of raw per-team averages (see
// leagueAverages.ts) — a materially different model, not a tuning tweak,
// so old predictions/feature_snapshots stay correctly attributed to the
// version that actually produced them (Section 37/38's reproducibility ask).
const MODEL_VERSION = "phase2-v2";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function parseDateArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  return arg ? arg.slice("--date=".length) : new Date().toISOString().slice(0, 10);
}

async function main() {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const date = parseDateArg();
  const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();

  await supabase.from("model_versions").upsert(
    {
      version: MODEL_VERSION,
      description:
        "Phase 2 analytical engine — Poisson (league-normalized attack/defense strength) + recentForm + teamStrength + goalPattern ensemble",
      config: { ensembleWeights: "default", decisionThresholds: "default" },
    },
    { onConflict: "version" },
  );

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, home_team, away_team, league, kickoff_time, home_odds, draw_odds, away_odds")
    .gte("kickoff_time", dayStart)
    .lte("kickoff_time", dayEnd);

  if (matchesError) throw matchesError;
  if (!matches?.length) {
    console.log(`no fixtures found for ${date}`);
    return;
  }

  // League-wide attack/defense baselines (see leagueAverages.ts) — computed
  // once per distinct league in this run's fixtures, from every team_stats
  // row on file for that league, not just the two teams in each match.
  const leagues = [...new Set(matches.map((m) => m.league as string))];
  const leagueAverages = new Map<string, LeagueAverages>();
  for (const league of leagues) {
    const { data: leagueTeamStats } = await supabase.from("team_stats").select("goals_scored_avg, goals_conceded_avg").eq("league", league);
    leagueAverages.set(
      league,
      computeLeagueAverages(
        (leagueTeamStats ?? []).map((r: { goals_scored_avg: number | null; goals_conceded_avg: number | null }) => ({
          goalsScoredAvg: r.goals_scored_avg,
          goalsConcededAvg: r.goals_conceded_avg,
        })),
      ),
    );
  }

  let predictionsWritten = 0;
  let decisionsWritten = 0;
  const decisionCounts: Record<string, number> = { VALUE_BET: 0, NO_EDGE: 0, COVERAGE_BET: 0 };

  for (const match of matches) {
    const league = leagueAverages.get(match.league as string)!;
    const { data: statsRows } = await supabase
      .from("team_stats")
      .select("*")
      .in("team_name", [match.home_team, match.away_team]);

    const homeRow: TeamStatsRow =
      (statsRows?.find((s: TeamStatsRow) => s.team_name === match.home_team) as TeamStatsRow | undefined) ??
      emptyTeamStatsRow(match.home_team);
    const awayRow: TeamStatsRow =
      (statsRows?.find((s: TeamStatsRow) => s.team_name === match.away_team) as TeamStatsRow | undefined) ??
      emptyTeamStatsRow(match.away_team);

    const asOf = match.kickoff_time;
    const home: TeamFeatures = buildTeamFeatures(homeRow, asOf, true);
    const away: TeamFeatures = buildTeamFeatures(awayRow, asOf, false);

    const { data: pastMeetingRows } = await supabase
      .from("matches")
      .select("home_team, away_team, home_score, away_score, kickoff_time")
      .or(
        `and(home_team.eq.${match.home_team},away_team.eq.${match.away_team}),and(home_team.eq.${match.away_team},away_team.eq.${match.home_team})`,
      )
      .lt("kickoff_time", asOf)
      .not("home_score", "is", null);

    const h2h = computeH2H((pastMeetingRows ?? []) as PastMeeting[], match.home_team, asOf);

    const { data: betpawaOddsRows } = await supabase
      .from("bookmaker_odds_snapshots")
      .select("market, selection, odds, source, captured_at")
      .eq("match_id", match.id);
    const pricedOdds = buildPricedOddsMap((betpawaOddsRows ?? []) as RawBookmakerOddsRow[]);

    const probs = runEnsemble(home, away, undefined, league);
    const odds: MatchOdds = { home: match.home_odds, draw: match.draw_odds, away: match.away_odds };
    const rankedCandidates = rankMarketCandidates(probs, home, away, odds, pricedOdds, league);
    const decision = decideBet(rankedCandidates);

    const { data: snapshot, error: snapshotError } = await supabase
      .from("feature_snapshots")
      .insert({
        match_id: match.id,
        model_version: MODEL_VERSION,
        features: { home, away, h2h, modelProbabilities: probs, leagueAverages: league },
      })
      .select("id")
      .single();
    if (snapshotError) throw snapshotError;

    const predictionRows = rankedCandidates.map((c) => ({
      match_id: match.id,
      feature_snapshot_id: snapshot.id,
      model_version: MODEL_VERSION,
      market: c.market,
      selection: c.selection,
      model_probability: c.modelProbability,
      implied_probability: c.impliedProbability,
      bookmaker_odds: c.bookmakerOdds,
      odds_source: c.oddsSource,
      odds_captured_at: c.oddsCapturedAt,
      edge: c.edge,
      ev: c.ev,
      confidence: c.confidence,
      data_quality: c.dataQuality,
      market_rank: c.marketRank,
    }));

    const { data: insertedPredictions, error: predictionsError } = await supabase
      .from("predictions")
      .insert(predictionRows)
      .select("id, market_rank");
    if (predictionsError) throw predictionsError;
    predictionsWritten += insertedPredictions?.length ?? 0;

    const bestPredictionId = insertedPredictions?.find((p) => p.market_rank === 1)?.id ?? null;

    const { error: decisionError } = await supabase.from("betting_decisions").insert({
      match_id: match.id,
      prediction_id: decision.decision === "VALUE_BET" ? bestPredictionId : null,
      decision: decision.decision,
      reason: decision.reason,
      model_version: MODEL_VERSION,
    });
    if (decisionError) throw decisionError;
    decisionsWritten += 1;
    decisionCounts[decision.decision] = (decisionCounts[decision.decision] ?? 0) + 1;

    console.log(`${match.home_team} vs ${match.away_team}: ${decision.decision} — ${decision.reason}`);
  }

  console.log(
    `\nDone. ${matches.length} fixtures, ${predictionsWritten} predictions, ${decisionsWritten} decisions written.`,
  );
  console.log(`Decisions: ${JSON.stringify(decisionCounts)}`);
  console.log(`\n(recommendations/recommended_bets were not touched — this is a separate, additive pipeline.)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
