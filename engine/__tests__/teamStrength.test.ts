import { describe, expect, it } from "vitest";
import { teamStrengthModel } from "../models/teamStrength.js";
import { makeTeamFeatures } from "./fixtures.js";

describe("teamStrengthModel", () => {
  it("returns neutral 1/3-1/3-1/3 when league position is unknown", () => {
    const home = makeTeamFeatures({ context: { asOf: "x", leaguePosition: null, leaguePoints: null, totalTeams: null, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, true);
    const away = makeTeamFeatures({}, false);
    const result = teamStrengthModel(home, away);
    expect(result.pHome).toBeCloseTo(1 / 3);
    expect(result.pDraw).toBeCloseTo(1 / 3);
    expect(result.pAway).toBeCloseTo(1 / 3);
  });

  it("regression: a big table-position gap now produces a decisive split, not a near-flat one", () => {
    // Real case, 2026-09-14: Inter (3rd) vs Udinese (13th) in a 20-team
    // league. Old formula gave pAway=19.9% here; BetPawa priced it ~7%.
    const home = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 3, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, true);
    const away = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 13, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, false);

    const result = teamStrengthModel(home, away);
    expect(result.pAway).toBeLessThan(0.10);
    expect(result.pHome).toBeGreaterThan(0.75);
  });

  it("draw probability shrinks as the position gap widens", () => {
    const closeHome = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 9, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, true);
    const closeAway = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 10, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, false);
    const farHome = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 1, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, true);
    const farAway = makeTeamFeatures({ context: { asOf: "x", leaguePosition: 20, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, false);

    const close = teamStrengthModel(closeHome, closeAway);
    const far = teamStrengthModel(farHome, farAway);
    expect(far.pDraw).toBeLessThan(close.pDraw);
  });

  it("still returns valid probabilities (1X2 sums to 1) across the full position range", () => {
    for (let homePos = 1; homePos <= 20; homePos += 4) {
      for (let awayPos = 1; awayPos <= 20; awayPos += 4) {
        const home = makeTeamFeatures({ context: { asOf: "x", leaguePosition: homePos, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, true);
        const away = makeTeamFeatures({ context: { asOf: "x", leaguePosition: awayPos, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null } }, false);
        const result = teamStrengthModel(home, away);
        expect(result.pHome + result.pDraw + result.pAway).toBeCloseTo(1, 6);
        expect(result.pHome).toBeGreaterThanOrEqual(0);
        expect(result.pAway).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
