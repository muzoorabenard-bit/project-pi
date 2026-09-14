// Explicit timestamp validation (spec Section 4). The overall architecture
// (reading back immutable feature_snapshots rows rather than reconstructing
// features from current, overwritten-in-place team_stats) already prevents
// most leakage structurally — but this is still a real, tested guard rather
// than an argument that it's unnecessary. A prediction failing this check
// is excluded and the reason recorded, never silently used.

export type LeakageStatus = "OK" | "LEAKAGE_DETECTED";

export interface LeakageCheckInput {
  kickoff: string;
  featureSnapshotCapturedAt: string;
  /** null when no real odds were used for this prediction (Section 7 —
   * markets without odds still get a model probability, just excluded from
   * betting-performance metrics; there's nothing to leak-check there). */
  oddsCapturedAt: string | null;
}

export interface LeakageCheckResult {
  status: LeakageStatus;
  reason?: string;
}

/**
 * Pure. Every "as_of" timestamp that fed a prediction must be <= the
 * fixture's own kickoff — anything captured after kickoff could only have
 * been influenced by information the match itself had already started
 * producing (in-play odds moves, injury news mid-match, etc.).
 */
export function checkLeakage(input: LeakageCheckInput): LeakageCheckResult {
  const kickoffMs = new Date(input.kickoff).getTime();

  const snapshotMs = new Date(input.featureSnapshotCapturedAt).getTime();
  if (snapshotMs > kickoffMs) {
    return {
      status: "LEAKAGE_DETECTED",
      reason: `feature_snapshot captured at ${input.featureSnapshotCapturedAt}, after kickoff ${input.kickoff}`,
    };
  }

  if (input.oddsCapturedAt !== null) {
    const oddsMs = new Date(input.oddsCapturedAt).getTime();
    if (oddsMs > kickoffMs) {
      return {
        status: "LEAKAGE_DETECTED",
        reason: `odds captured at ${input.oddsCapturedAt}, after kickoff ${input.kickoff}`,
      };
    }
  }

  return { status: "OK" };
}
