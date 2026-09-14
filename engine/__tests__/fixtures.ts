import type { HomeAwayStats, TeamFeatures } from "../types.js";

const ASOF = "2026-09-14T00:00:00Z";

function homeAway(overrides: Partial<HomeAwayStats> = {}): HomeAwayStats {
  return {
    asOf: ASOF,
    wins: 3,
    draws: 1,
    losses: 2,
    goalsScoredAvg: 1.6,
    goalsConcededAvg: 1.1,
    cleanSheetStreak: null,
    unbeatenStreak: 2,
    ...overrides,
  };
}

export function makeTeamFeatures(overrides: Partial<TeamFeatures> = {}, isHome = true): TeamFeatures {
  return {
    team: isHome ? "Home FC" : "Away FC",
    overall: {
      asOf: ASOF,
      played: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      goalsScoredAvg: 1.6,
      goalsConcededAvg: 1.1,
      bttsRate: 0.5,
      over15Rate: null,
      over25Rate: 0.5,
      under25Rate: 0.5,
      cleanSheets: 2,
      failedToScore: null,
    },
    home: isHome ? homeAway() : null,
    away: isHome ? null : homeAway({ goalsScoredAvg: 1.3, goalsConcededAvg: 1.4 }),
    context: {
      asOf: ASOF,
      leaguePosition: isHome ? 5 : 12,
      leaguePoints: isHome ? 40 : 25,
      totalTeams: 20,
      gapToRelegation: isHome ? 22 : 7,
      gapToTop4: isHome ? 4 : 15,
      restDays: 6,
      fixtureCongestion: false,
    },
    ...overrides,
  };
}

export function makeSparseTeamFeatures(isHome = true): TeamFeatures {
  return {
    team: isHome ? "New FC" : "Newer FC",
    overall: {
      asOf: ASOF,
      played: 1,
      wins: 0,
      draws: 0,
      losses: 1,
      goalsScoredAvg: null,
      goalsConcededAvg: null,
      bttsRate: null,
      over15Rate: null,
      over25Rate: null,
      under25Rate: null,
      cleanSheets: null,
      failedToScore: null,
    },
    home: null,
    away: null,
    context: {
      asOf: ASOF,
      leaguePosition: null,
      leaguePoints: null,
      totalTeams: null,
      gapToRelegation: null,
      gapToTop4: null,
      restDays: null,
      fixtureCongestion: null,
    },
  };
}
