import { devigProbabilities } from "../edge/edgeEngine.js";
import { resolveOutcome } from "./resolveOutcome.js";
import { brierScoreFor, logLossFor, type ProbabilityOutcomePair } from "./metrics.js";
import type { BacktestableRecord } from "./historicalSnapshotProvider.js";

export interface BaselineComparison {
  sampleSize: number;
  model: { brierScore: number | null; logLoss: number | null };
  rawMarket: { brierScore: number | null; logLoss: number | null }; // 1/odds, WITH the bookmaker's overround baked in
  normalizedMarket: { brierScore: number | null; logLoss: number | null }; // de-vigged, Section 13
}

/**
 * Section 20 — "does the model provide information beyond the market?"
 * Restricted to the 1X2 result market (Section 13: "for 1X2, use all three
 * outcomes" — Double Chance/BTTS/O-U are two-way markets where the
 * de-vig computation is the same shape but this keeps scope to the case the
 * spec explicitly asks for). Only records where all three 1X2 prices exist
 * and the actually-decided market is one of HOME_WIN/DRAW/AWAY_WIN qualify —
 * a fair three-way comparison needs the full triple, not just the one price
 * that happened to be bet.
 */
export function compareAgainstMarketBaseline(records: BacktestableRecord[]): BaselineComparison {
  const modelPairs: ProbabilityOutcomePair[] = [];
  const rawMarketPairs: ProbabilityOutcomePair[] = [];
  const normalizedMarketPairs: ProbabilityOutcomePair[] = [];

  for (const record of records) {
    const { decision } = record;
    if (!decision || decision.decision !== "VALUE_BET") continue;
    if (decision.predictionMarket !== "HOME_WIN" && decision.predictionMarket !== "DRAW" && decision.predictionMarket !== "AWAY_WIN") continue;

    const home = record.predictions.find((p) => p.market === "HOME_WIN");
    const draw = record.predictions.find((p) => p.market === "DRAW");
    const away = record.predictions.find((p) => p.market === "AWAY_WIN");
    if (!home?.bookmakerOdds || !draw?.bookmakerOdds || !away?.bookmakerOdds) continue;

    const decided = decision.predictionMarket === "HOME_WIN" ? home : decision.predictionMarket === "DRAW" ? draw : away;
    const outcome = resolveOutcome(decision.predictionMarket, decision.predictionSelection!, record.homeScore, record.awayScore);
    if (outcome === "void") continue;
    const won = outcome === "win";

    const rawImplied = [1 / home.bookmakerOdds, 1 / draw.bookmakerOdds, 1 / away.bookmakerOdds];
    const normalized = devigProbabilities(rawImplied);
    const index = decision.predictionMarket === "HOME_WIN" ? 0 : decision.predictionMarket === "DRAW" ? 1 : 2;

    modelPairs.push({ probability: decided.modelProbability, won });
    rawMarketPairs.push({ probability: rawImplied[index]!, won });
    normalizedMarketPairs.push({ probability: normalized[index]!, won });
  }

  return {
    sampleSize: modelPairs.length,
    model: { brierScore: brierScoreFor(modelPairs), logLoss: logLossFor(modelPairs) },
    rawMarket: { brierScore: brierScoreFor(rawMarketPairs), logLoss: logLossFor(rawMarketPairs) },
    normalizedMarket: { brierScore: brierScoreFor(normalizedMarketPairs), logLoss: logLossFor(normalizedMarketPairs) },
  };
}
