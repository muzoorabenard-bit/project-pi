// Rest-days / fixture-congestion signals (Phase 2 spec, Section 4's
// "Context" list). Kept separate from featureEngine.ts's league-table-driven
// ContextStats fields since this needs a different input shape (a team's
// recent kickoff timestamps, not a team_stats row) and is meant to be filled
// in incrementally — today only fetch-fixtures' pulled fixtures are
// available, so this only works for matches where enough fixture history
// has already been ingested locally; otherwise it returns null rather than
// guessing.

const CONGESTION_WINDOW_DAYS = 10;
const CONGESTION_THRESHOLD_MATCHES = 3;

export interface RestDaysResult {
  restDays: number | null;
  fixtureCongestion: boolean | null;
}

/**
 * Pure. `priorKickoffs` must be every kickoff timestamp (ISO strings) for
 * this team's matches strictly before `asOf`, most-recent-first not
 * required — this sorts internally. Returns nulls (never a guess) when
 * there's no prior fixture in the local dataset to compare against.
 */
export function computeRestDays(priorKickoffs: string[], asOf: string): RestDaysResult {
  if (priorKickoffs.length === 0) {
    return { restDays: null, fixtureCongestion: null };
  }

  const asOfMs = new Date(asOf).getTime();
  const sorted = [...priorKickoffs]
    .map((k) => new Date(k).getTime())
    .filter((t) => t < asOfMs)
    .sort((a, b) => b - a);

  if (sorted.length === 0) {
    return { restDays: null, fixtureCongestion: null };
  }

  const mostRecent = sorted[0] as number;
  const restDays = Math.round((asOfMs - mostRecent) / (24 * 60 * 60 * 1000));

  const windowStart = asOfMs - CONGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const matchesInWindow = sorted.filter((t) => t >= windowStart).length;

  return {
    restDays,
    fixtureCongestion: matchesInWindow >= CONGESTION_THRESHOLD_MATCHES,
  };
}
