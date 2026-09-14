import type { H2HStats } from "../types.js";

/** Mirrors the subset of `matches` columns needed for H2H — one row per
 * previous meeting between the same two teams, already finished. */
export interface PastMeeting {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  kickoff_time: string;
}

const MAX_H2H_MATCHES = 5;

/**
 * Pure — derives recent head-to-head purely from previously-finished
 * `matches` rows already sitting in this project's own database (no new
 * external fetch needed; football-data.org's free tier has no dedicated H2H
 * endpoint, but every past meeting the fixtures cron already pulled is
 * sitting right here). Caller is responsible for passing only matches with
 * a kickoff strictly before `asOf` (see context.ts's leakage note) and for
 * scoreless (null score) rows already filtered out.
 */
export function computeH2H(pastMeetings: PastMeeting[], homeTeam: string, asOf: string): H2HStats {
  const relevant = pastMeetings
    .filter((m) => m.home_score !== null && m.away_score !== null)
    .sort((a, b) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime())
    .slice(0, MAX_H2H_MATCHES);

  let homeWins = 0, draws = 0, awayWins = 0, totalGoalsSum = 0;

  for (const m of relevant) {
    const hs = m.home_score as number;
    const as = m.away_score as number;
    totalGoalsSum += hs + as;

    // Normalize to "the team that is home in *this* fixture" regardless of
    // which side they were on in the historical meeting.
    const thisFixtureHomeWasHomeThen = m.home_team === homeTeam;
    const thisFixtureHomeScore = thisFixtureHomeWasHomeThen ? hs : as;
    const thisFixtureAwayScore = thisFixtureHomeWasHomeThen ? as : hs;

    if (thisFixtureHomeScore > thisFixtureAwayScore) homeWins++;
    else if (thisFixtureHomeScore < thisFixtureAwayScore) awayWins++;
    else draws++;
  }

  return {
    asOf,
    matchesConsidered: relevant.length,
    homeWins,
    draws,
    awayWins,
    avgTotalGoals: relevant.length > 0 ? +(totalGoalsSum / relevant.length).toFixed(2) : null,
  };
}
