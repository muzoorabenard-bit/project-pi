import { describe, expect, it } from "vitest";
import { attackStrength, computeLeagueAverages, defenseStrength, FALLBACK_LEAGUE_AVERAGES } from "../models/leagueAverages.js";
import { matchResultProbabilities } from "../models/poisson.js";
import { buildModelSignals } from "../models/ensemble.js";
import { makeTeamFeatures } from "./fixtures.js";

describe("computeLeagueAverages", () => {
  it("averages goals scored/conceded across every team with data", () => {
    const league = computeLeagueAverages([
      { goalsScoredAvg: 2.0, goalsConcededAvg: 1.0 },
      { goalsScoredAvg: 1.0, goalsConcededAvg: 2.0 },
    ]);
    expect(league.avgGoalsScoredPerTeam).toBeCloseTo(1.5);
    expect(league.avgGoalsConcededPerTeam).toBeCloseTo(1.5);
    expect(league.sampleSize).toBe(2);
  });

  it("skips teams with null averages rather than treating them as 0", () => {
    const league = computeLeagueAverages([
      { goalsScoredAvg: 2.0, goalsConcededAvg: 1.0 },
      { goalsScoredAvg: null, goalsConcededAvg: null },
    ]);
    expect(league.avgGoalsScoredPerTeam).toBeCloseTo(2.0);
    expect(league.sampleSize).toBe(1);
  });

  it("falls back to the documented default (never 0) when no team has data", () => {
    expect(computeLeagueAverages([])).toEqual(FALLBACK_LEAGUE_AVERAGES);
    expect(computeLeagueAverages([{ goalsScoredAvg: null, goalsConcededAvg: null }])).toEqual(FALLBACK_LEAGUE_AVERAGES);
  });
});

describe("attackStrength / defenseStrength", () => {
  const league = { avgGoalsScoredPerTeam: 1.5, avgGoalsConcededPerTeam: 1.5, sampleSize: 10 };

  it("is 1.0 for a perfectly average team", () => {
    expect(attackStrength(1.5, league)).toBeCloseTo(1.0);
    expect(defenseStrength(1.5, league)).toBeCloseTo(1.0);
  });

  it("is >1 for an above-average attack and <1 for a below-average one", () => {
    expect(attackStrength(3.0, league)).toBeCloseTo(2.0);
    expect(attackStrength(0.75, league)).toBeCloseTo(0.5);
  });
});

describe("league-relative magnitude changes the Poisson split, even at a fixed xG ratio", () => {
  // The property that actually matters: attackStrength/defenseStrength keep
  // the HOME:AWAY xG ratio for two same-league teams unchanged from the old
  // raw-average formula (the league constant cancels out of that ratio
  // algebraically) — what changes is the ABSOLUTE scale, now driven by this
  // league's real scoring rate instead of one hardcoded 1.4 for every
  // league. Poisson's shape is nonlinear in absolute scale: the same ratio
  // at a higher scale produces fewer draws and a more decisive favorite,
  // which is a real, verifiable effect, not an artifact.
  it("scaling both sides up at a fixed ratio reduces the draw share and sharpens the favorite's edge", () => {
    const low = matchResultProbabilities(1.8, 1.0); // ratio 1.8, old-constant-like scale
    const high = matchResultProbabilities(3.6, 2.0); // same ratio 1.8, Serie-A-like scale

    expect(high.pDraw).toBeLessThan(low.pDraw);
    expect(high.pHome).toBeGreaterThan(low.pHome);
  });
});

describe("regression: the live 2026-09-14 Inter vs Udinese miscalibration", () => {
  // BetPawa priced Udinese's away win at Inter at ~7% (odds 14.31). The
  // pre-fix Poisson signal (raw averages ÷ a hardcoded 1.4 for every
  // league, no home-advantage factor) put it at 19.7% — this guards against
  // silently regressing back to that. Serie A's real observed average here
  // (~1.85 goals/team, 6-team sample) is richer than the old constant, and
  // the ensemble now also applies a home-advantage multiplier that did not
  // exist before at all.
  const serieA = { avgGoalsScoredPerTeam: 1.8467, avgGoalsConcededPerTeam: 1.2367, sampleSize: 6 };
  const PRE_FIX_POISSON_PAWAY = 0.1971;

  it("the fixed Poisson signal's away-win probability is measurably lower than the pre-fix value", () => {
    // home/away splits explicitly null (not captured for these two teams on
    // the real day this was found) so the model falls back to `overall`,
    // exactly matching the live scenario being regression-tested.
    const inter = makeTeamFeatures(
      {
        overall: { asOf: "2026-09-14", played: 4, wins: 3, draws: 0, losses: 1, goalsScoredAvg: 2.25, goalsConcededAvg: 1.25, bttsRate: null, over15Rate: null, over25Rate: null, under25Rate: null, cleanSheets: null, failedToScore: null },
        home: null,
        context: { asOf: "2026-09-14", leaguePosition: 3, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null },
      },
      true,
    );
    const udinese = makeTeamFeatures(
      {
        overall: { asOf: "2026-09-14", played: 3, wins: 1, draws: 1, losses: 1, goalsScoredAvg: 1.67, goalsConcededAvg: 1.67, bttsRate: null, over15Rate: null, over25Rate: null, under25Rate: null, cleanSheets: null, failedToScore: null },
        away: null,
        context: { asOf: "2026-09-14", leaguePosition: 13, leaguePoints: null, totalTeams: 20, gapToRelegation: null, gapToTop4: null, restDays: null, fixtureCongestion: null },
      },
      false,
    );

    const signals = buildModelSignals(inter, udinese, undefined, serieA);
    const poissonSignal = signals.find((s) => s.name === "poisson")!;

    expect(poissonSignal.probabilities.pAway!).toBeLessThan(PRE_FIX_POISSON_PAWAY);
  });
});
