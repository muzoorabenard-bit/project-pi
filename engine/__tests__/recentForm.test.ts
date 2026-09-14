import { describe, expect, it } from "vitest";
import { recentFormModel } from "../models/recentForm.js";
import { makeTeamFeatures } from "./fixtures.js";

function withRecord(wins: number, draws: number, losses: number, isHome: boolean) {
  return makeTeamFeatures(
    {
      overall: {
        asOf: "x", played: wins + draws + losses, wins, draws, losses,
        goalsScoredAvg: 1.4, goalsConcededAvg: 1.4, bttsRate: 0.5, over15Rate: null, over25Rate: 0.5, under25Rate: 0.5,
        cleanSheets: null, failedToScore: null,
      },
    },
    isHome,
  );
}

describe("recentFormModel", () => {
  it("returns a valid 1X2 distribution that sums to 1", () => {
    const result = recentFormModel(withRecord(3, 1, 1, true), withRecord(1, 2, 2, false));
    expect(result.pHome + result.pDraw + result.pAway).toBeCloseTo(1, 6);
  });

  it("favors the team with the better shrunk points-per-game", () => {
    const strong = withRecord(10, 0, 0, true); // 3.0 raw ppg, 10 games — shrinkage barely matters at this sample size
    const weak = withRecord(0, 0, 10, false); // 0.0 raw ppg, 10 games
    const result = recentFormModel(strong, weak);
    expect(result.pHome).toBeGreaterThan(result.pAway);
  });

  it("shrinkage tempers a tiny, extreme early-season sample toward the league average", () => {
    // 1 game, perfect record — raw ppg would be 3.0, an extreme read from a
    // single data point. Shrinkage should pull this toward neutral much
    // more than a well-established 10-game 3.0-ppg record would be.
    const tinySample = withRecord(1, 0, 0, true);
    const establishedSample = withRecord(10, 0, 0, true);
    const neutralAway = withRecord(2, 2, 2, false); // 1.33 ppg, moderate

    const tiny = recentFormModel(tinySample, neutralAway);
    const established = recentFormModel(establishedSample, neutralAway);

    // The 1-game "perfect record" should look LESS extreme (closer to 0.5)
    // than the well-established 10-game one, since shrinkage discounts it.
    expect(tiny.pHome).toBeLessThan(established.pHome);
  });

  it("a team with zero games played is treated as exactly league-average (1.5 ppg), not artificially weak or strong", () => {
    const noGames = withRecord(0, 0, 0, true);
    const alsoNoGames = withRecord(0, 0, 0, false);
    const result = recentFormModel(noGames, alsoNoGames);
    // Only the fixed home-advantage-points offset should separate them.
    expect(result.pHome).toBeGreaterThan(result.pAway);
    expect(result.pHome).toBeLessThan(0.6); // modest edge, not a confident one
  });
});
