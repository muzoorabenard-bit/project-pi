import { config } from "dotenv";
import { createBacktestSupabaseClient, fetchHistoricalDataset } from "../historicalSnapshotProvider.js";
import { buildBacktestReport, printReport } from "../report.js";
import { DEFAULT_ENSEMBLE_WEIGHTS } from "../../models/ensemble.js";

// Read-only measurement tool. Never touches recommendations/recommended_bets,
// never places anything, never changes model/ensemble/staking code. Section
// 27's safety gate: this file has no import from ai-bet-ug or any BetPawa
// automation, and does not write to `predictions`/`betting_decisions`
// (those are generatePredictions.ts's job) — it only reads them back.

config();

const MODEL_VERSION = "phase2-v2";
const CONFIG_VERSION = "ensemble-weights-45-25-15-15";

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : undefined;
}

async function main() {
  const supabase = createBacktestSupabaseClient();

  const filter = {
    fromDate: argValue("from"),
    toDate: argValue("to"),
    league: argValue("league"),
    market: argValue("market") as import("../../markets/whitelist.js").ApprovedMarket | undefined,
  };

  const today = new Date().toISOString().slice(0, 10);
  const periodStart = filter.fromDate ?? "earliest available";
  const periodEnd = filter.toDate ?? today;

  const { backtestable, rejected } = await fetchHistoricalDataset(supabase, filter);
  const report = buildBacktestReport(backtestable, rejected, periodStart, periodEnd);

  console.log(printReport(report));

  const { error } = await supabase.from("backtest_runs").insert({
    model_version: MODEL_VERSION,
    config_version: CONFIG_VERSION,
    start_date: filter.fromDate ?? "2000-01-01",
    end_date: filter.toDate ?? today,
    league_filter: filter.league ?? null,
    market_filter: filter.market ?? null,
    report,
  });
  if (error) {
    console.error("\n(warning: failed to persist this run to backtest_runs)", error);
  } else {
    console.log("\n(run persisted to backtest_runs for reproducibility)");
  }

  // Ensemble weights used are always the current defaults unless a future
  // CLI flag overrides them — surfaced here so a report is self-describing.
  console.log(`\nEnsemble weights used: ${JSON.stringify(DEFAULT_ENSEMBLE_WEIGHTS)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
