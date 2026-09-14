import type { ApprovedMarket } from "../markets/whitelist.js";

export type Outcome = "win" | "loss" | "void";

/**
 * Pure — settles one market/selection against a final score. Mirrors the
 * same responsibility as project-pi's existing
 * `settle-results/index.ts::determineOutcomeForBet`, but against this
 * engine's own market vocabulary (HOME_WIN/DRAW/... rather than BetPawa's
 * 1X2/Double Chance strings) since the two are deliberately kept separate
 * until an explicit bridging step (see PHASE_2_CODEBASE_ASSESSMENT.md).
 */
export function resolveOutcome(
  market: ApprovedMarket,
  selection: string,
  homeScore: number,
  awayScore: number,
): Outcome {
  const totalGoals = homeScore + awayScore;
  const bttsYes = homeScore > 0 && awayScore > 0;

  switch (market) {
    case "HOME_WIN":
      return homeScore > awayScore ? "win" : "loss";
    case "DRAW":
      return homeScore === awayScore ? "win" : "loss";
    case "AWAY_WIN":
      return awayScore > homeScore ? "win" : "loss";
    case "HOME_DRAW":
      return homeScore >= awayScore ? "win" : "loss";
    case "HOME_AWAY":
      return homeScore !== awayScore ? "win" : "loss";
    case "DRAW_AWAY":
      return awayScore >= homeScore ? "win" : "loss";
    case "OVER_1_5":
      return totalGoals > 1.5 ? "win" : "loss";
    case "OVER_2_5":
      return totalGoals > 2.5 ? "win" : "loss";
    case "UNDER_2_5":
      return totalGoals < 2.5 ? "win" : "loss";
    case "BTTS_YES":
      return bttsYes ? "win" : "loss";
    case "BTTS_NO":
      return !bttsYes ? "win" : "loss";
    case "TEAM_GOALS":
      if (selection === "HOME_OVER_0_5") return homeScore > 0 ? "win" : "loss";
      if (selection === "AWAY_OVER_0_5") return awayScore > 0 ? "win" : "loss";
      throw new Error(`resolveOutcome: unknown TEAM_GOALS selection "${selection}"`);
    default: {
      const exhaustiveCheck: never = market;
      throw new Error(`resolveOutcome: unhandled market "${exhaustiveCheck}"`);
    }
  }
}
