# Backtest Assessment — AI Bet UG Analytical Engine

Produced before any backtesting-framework code, per this project's own Section 1
instruction. No model code is touched to produce this document — everything below is
read-only inspection.

---

## 1. Existing relevant code

```
project-pi/
  engine/
    types.ts                        — Fixture, TeamFeatures, FeatureSnapshot,
                                       ModelSignal, MarketCandidate, RankedPrediction,
                                       BettingDecisionResult
    markets/whitelist.ts             — the 12-market approved list, enforced in code
    features/featureEngine.ts        — team_stats row → TeamFeatures (pure)
    features/h2h.ts, context.ts      — head-to-head / rest-days (pure)
    models/poisson.ts                — Model A: strength-normalized Poisson xG
    models/recentForm.ts             — Model B: shrunk-PPG logistic
    models/teamStrength.ts           — Model C: league-position logistic
    models/goalPattern.ts            — Model D: crude "pressure index" O/U lookup
    models/leagueAverages.ts         — per-league attack/defense baselines
    models/ensemble.ts               — buildModelSignals() + combineSignals() + runEnsemble()
    edge/edgeEngine.ts               — impliedProbability / edge / EV (pure)
    ranking/rankMarkets.ts           — generates all 13 candidates/fixture, prices, ranks
    decision/decisionEngine.ts       — VALUE_BET / NO_EDGE / COVERAGE_BET (pure, deterministic)
    dataQuality/dataQuality.ts       — HIGH/MEDIUM/LOW/INSUFFICIENT scoring
    odds/betpawaOddsAdapter.ts       — BetPawa vocabulary → engine vocabulary + real-odds map
    staking/*                        — Kelly/fractional-Kelly/exposure (foundation only, unused)
    backtest/resolveOutcome.ts       — market+selection+score → win/loss/void (pure)
    backtest/replay.ts               — chronological replay harness (already leak-guarded)
    backtest/metrics.ts              — summarizePerformance/brierScore/logLoss/calibrationTable
    cli/generatePredictions.ts       — live entry point: DB → features → ensemble → predictions
  supabase/migrations/005, 006       — predictions/betting_decisions/feature_snapshots/
                                       model_versions/audit_logs, bookmaker_odds_snapshots
  .github/workflows/predictions.yml  — daily schedule (06:30 UTC), forward-only

ai-bet-ug/
  src/cli/captureOdds.ts             — read-only, real BetPawa odds → bookmaker_odds_snapshots
  .github/workflows/poll.yml         — capture-odds job (05:35 UTC), forward-only
```

**Important:** a chronological backtest harness (`engine/backtest/replay.ts`) and metrics
module (`engine/backtest/metrics.ts`) **already exist** from Phase 2 — built specifically
to be leak-safe (feature/odds providers only ever receive fixture metadata, never a score;
the result provider is consulted only after a decision is already made) and to run the
existing models unchanged. This request extends that foundation with calibration
bins, edge-bucket analysis, model-by-model diagnostics, inter-model agreement, extreme-
probability auditing, and reporting — it does not need to build chronological ordering
or leakage protection from scratch.

## 2. Reusable functions (call these directly — do not reimplement)

| Need | Function | Notes |
|---|---|---|
| Run all 4 models separately | `buildModelSignals(home, away, weights?, league?)` | Already returns one named `ModelSignal` per model — exactly Section 6/14's "store each model separately" and "evaluate each model" requirements, with zero new code needed to get per-model outputs |
| Combine into ensemble | `combineSignals(signals)` | Same weighted-average + renormalize logic the live path uses |
| Full ensemble in one call | `runEnsemble(home, away, weights?, league?)` | Calls both of the above |
| Price + rank every market | `rankMarketCandidates(probs, home, away, fallbackOdds, pricedOdds?, league?)` | Existing edge/EV/dataQuality/ranking, unchanged |
| Decide VALUE_BET/NO_EDGE/COVERAGE_BET | `decideBet(rankedCandidates, thresholds?)` | Pure, deterministic — exactly Section 8's "use the existing market probability calculations" |
| Settle a market against a score | `resolveOutcome(market, selection, homeScore, awayScore)` | Already implements Section 8's win/loss rules for all 12 approved markets |
| Chronological, leak-guarded replay | `replayFixtures(fixtures, featureProvider, oddsProvider, resultProvider, options?)` | Already sorts by kickoff ascending regardless of input order; already never exposes scores to the decision path |
| League-relative attack/defense baseline | `computeLeagueAverages(rows)` | Needed to reconstruct league averages "as of" a historical point (Section 3) |
| Performance/calibration primitives | `summarizePerformance`, `brierScore`, `logLoss`, `calibrationTable`, `summarizeByMarket`, `summarizeByLeague` | Cover most of Sections 9/11/18 already; need extending for edge-bucket (Section 12) and per-model (Section 14) grouping, which is straightforward given `BacktestRow` already carries the full `rankedCandidates` array |

None of these need modification. The new work is: a data-reconstruction layer that
feeds `replayFixtures` real historical snapshots instead of live ones, additional
metrics groupings, an inter-model-agreement calculator, an extreme-probability
auditor, and a CLI + report generator around all of it.

## 3. Available historical data — the critical constraint

**There is currently no historical data to backtest against.** The entire Supabase
project was rebuilt from scratch on 2026-09-13 after an unrelated outage (see prior
session). As of this writing:

- `matches`: **5 rows total, ever.** All from today (2026-09-14), all `status='scheduled'`,
  zero with a final score. No prior matchday, no prior season exists in this database.
- `team_stats`: **10 rows total**, all written within the same 66-second window today
  (`updated_at` between 05:01:11 and 05:02:17 UTC) — a single snapshot in time, not a
  history. There has never been more than one row per team; `fetch-fixtures` upserts
  in place (`onConflict: 'team_id,league'`), so a team's stats from a week ago are
  already gone, overwritten, the moment they're refreshed.
- `bookmaker_odds_snapshots`: **60 rows**, all from the one manual `capture-odds` run
  today (13:35–13:36 UTC). No historical BetPawa prices exist from before today at all
  — this table didn't exist before today's session.
- `predictions`/`feature_snapshots`/`betting_decisions`: 65/5/5 rows, all from today's
  two `predictions:generate` runs.

**Consequence:** genuine chronological backtesting over real match history (Sections
17-20: time-based evaluation, league-by-league with meaningful samples, walk-forward
validation) is not possible today — there is no "before" to walk forward through yet.
What *is* real and already running: the daily schedule set up in the prior session
(`capture-odds` 05:35 UTC, `predictions:generate` 06:30 UTC) is accumulating exactly
the kind of point-in-time snapshots a real backtest needs, starting from today. This
assessment's proposed architecture (Section 6 below) is designed to be useful in two
distinct modes:
1. **Today**: a near-empty/trivial run, useful only for proving the harness itself
   works correctly (leakage guard, metrics math, reproducibility) — not for drawing any
   real conclusion about model quality yet.
2. **In days/weeks**, once fixtures from today (and each subsequent day) have actually
   kicked off and `settle-results`' existing hourly cron has written real scores into
   `matches.home_score`/`away_score` — at that point the same harness, unmodified,
   starts producing a genuine (if still small-sample) calibration picture.

This is worth being explicit about before building anything: **the deliverable today
is the measurement system, not a measurement.** The report this produces right now
will say, correctly, "insufficient data" almost everywhere.

## 4. Missing data (beyond the volume problem above)

- **No point-in-time `team_stats` history at all**, independent of how much time
  passes. `fetch-fixtures` overwrites each team's row in place. Even a month from now,
  reconstructing "what were Inter's stats as of 2026-09-14" will be impossible unless
  something starts snapshotting `team_stats` over time. `feature_snapshots` (written by
  `generatePredictions.ts`) *does* capture a full point-in-time copy of the features
  used for each prediction — this is the one place point-in-time history is actually
  being preserved going forward, and it's exactly what a future backtest should read
  from rather than trying to reconstruct `team_stats` retroactively.
- **No historical bookmaker odds before today**, at all, for any market. Any backtest
  covering fixtures from before 2026-09-14 has zero real odds to compute edge/EV
  against — those predictions can only ever get a model probability, never a real
  betting-performance number (Section 7 already anticipates this: "markets without
  historical odds may still have model probabilities recorded, but must be excluded
  from betting-performance calculations").
- **No historical league standings/averages** either — `computeLeagueAverages` can only
  be computed "as of now" from whatever's currently in `team_stats`, not "as of" some
  past date, for the same overwrite-in-place reason.

## 5. Leakage risks specific to this codebase

1. **`team_stats` has no `as_of` granularity finer than "whenever it was last
   refreshed."** `generatePredictions.ts` already stores a `feature_snapshots` row
   with the exact `TeamFeatures` used at prediction time — a backtest reading from
   `feature_snapshots` (rather than re-deriving from `team_stats`) is leak-safe by
   construction, since that row is immutable once written. A backtest that instead
   tries to reconstruct features from *current* `team_stats` for a past fixture would
   silently leak everything learned since that fixture happened — this must be
   explicitly disallowed.
2. **`computeLeagueAverages` reads all teams' *current* stats.** Same risk as above —
   only safe to compute from a stored `feature_snapshots` row's own recorded league
   averages (already saved there — see `generatePredictions.ts`'s
   `features: { ..., leagueAverages: league }`), never recomputed live for a
   historical fixture.
3. **`bookmaker_odds_snapshots.captured_at`** is the only real odds timestamp that
   exists; a backtest must never use a snapshot whose `captured_at` is after the
   fixture's `kickoff_time` — straightforward today since capture only ever happens
   pre-kickoff, but worth an explicit assertion once snapshots accumulate and multiple
   captures-per-fixture become possible (e.g. if capture-odds frequency increases later).
4. **`replayFixtures`'s existing leakage guard is a good foundation but is generic** —
   it protects against a caller mistake in the *replay loop itself*, but doesn't
   currently validate that a `FeatureSnapshot` object handed to it actually has an
   `as_of`/`capturedAt` ≤ the fixture's kickoff. This project's Section 4 explicit
   timestamp-validation layer (`LEAKAGE_DETECTED` status) is genuinely new work, not
   already covered.

## 6. Model problems already discovered (from the prior session, documented not fixed here)

Per this project's own instruction to document rather than fix:

- **Poisson, recentForm, and teamStrength were all previously found to independently
  overrate a big underdog** in a real live case (Inter 3rd vs Udinese 13th, Serie A,
  2026-09-14): pre-fix values were 19.7%, 19.1%, 19.9% respectively for Udinese to win,
  against a bookmaker-implied ~7%. All three have since been modified (strength-
  normalized xG + home-advantage multiplier; PPG shrinkage; logistic position-gap +
  shrinking draw band) — teamStrength's standalone output moved to 6.7% after its fix;
  Poisson's to 16.2%; the two together still leave recentForm and the ensemble's fixed-
  weight blend as open questions.
- **The ensemble's 45/25/15/15 weights are unvalidated** and were chosen by hand, not
  fitted. In the same real case, fixing teamStrength individually (a 13-point swing)
  moved the *ensemble's* combined output by less than 0.5 points, because a 15%-weighted
  model's improvement is structurally diluted by three other unchanged/lower-quality
  signals. This is precisely the kind of finding Section 14/15 (model-by-model
  diagnostics, inter-model agreement) is designed to surface systematically instead of
  one anecdote at a time.
- **`goalPattern` (Model D) is the crudest of the four** — a hardcoded 7-row lookup
  table mapping a "pressure index" to Over/Under 2.5, with no real fitting behind it,
  and it contributes a neutral 1/3-1/3-1/3 to every 1X2 prediction by construction
  (diluting, never sharpening, the ensemble's result-market signal). Worth specific
  scrutiny once model-by-model calibration numbers exist.
- **Several fixtures on 2026-09-14 produced EV in the 200%+ range post-fixes** (Como
  vs Parma +197.6%, Villarreal vs Betis +208.4%, Inter vs Udinese +206.3%) — numbers
  this implausible in an efficient, mainstream-league market are themselves evidence
  the ensemble is still miscalibrated somewhere, independent of any single model's
  individual correctness. Section 16's extreme-probability audit is designed to catch
  exactly this pattern systematically.

## 7. Proposed backtest architecture

```
engine/backtest/
  historicalSnapshotProvider.ts   — NEW: reads feature_snapshots (not team_stats) for
                                     a given match_id, returns null if none exists —
                                     this IS the leak-safety mechanism (point 1 above)
  leakageGuard.ts                  — NEW: explicit timestamp validation (Section 4),
                                     returns LEAKAGE_DETECTED + reason rather than
                                     silently proceeding
  modelDiagnostics.ts              — NEW: per-model (not just ensemble) Brier/logLoss/
                                     calibration, built on the existing per-model
                                     ModelSignal data already stored in feature_snapshots
  agreement.ts                     — NEW: min/max/mean/stddev across the 4 models per
                                     prediction (Section 15)
  edgeBuckets.ts                   — NEW: groups BacktestRow[] by edge range (Section 12)
  extremeAudit.ts                  — NEW: filters + formats predictions crossing the
                                     probability/edge/EV thresholds in Section 16
  baseline.ts                      — NEW: normalized-market-probability baseline vs.
                                     model, per Section 20
  report.ts                        — NEW: assembles everything above into the Section 25
                                     report format, including "WHAT IS ACTUALLY BROKEN?"
  cli/runBacktest.ts                — NEW: `npm run backtest -- --from= --to= --league= --market=`

supabase/migrations/007_backtest_runs.sql — NEW, minimal:
  backtest_runs (run_id, created_at, model_version, config_version, start_date, end_date)
  backtest_predictions (run_id, match_id, market, selection, model_probability,
    bookmaker_odds, implied_probability, normalized_market_probability, edge, ev,
    data_quality, actual_outcome, is_winner, leakage_status)
  backtest_model_outputs (backtest_prediction_id, model_name, probability)
```

`historicalSnapshotProvider.ts` is the load-bearing piece: it makes `replayFixtures`
safe to run over real history (once history exists) by construction, since it can
only ever return what was actually recorded pre-kickoff — there is no code path that
lets it accidentally consult current `team_stats`.

---

**Status:** assessment complete, no model or live-execution code touched. Given the
data-depth finding in Section 3, I'd like to confirm scope before implementing further.
