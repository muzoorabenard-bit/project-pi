import type { DataQuality, TeamFeatures } from "../types.js";

export interface DataQualityResult {
  quality: DataQuality;
  reasons: string[]; // explicit list of what's missing/stale — never silently invented (Section 10)
}

const MIN_PLAYED_FOR_FORM = 3;

/**
 * Pure. Scores how much of the expected feature surface is actually present
 * for this specific match, plus whether bookmaker odds exist at all — a
 * candidate with a probability but no odds can't be priced into edge/EV
 * regardless of how good the model input is.
 */
export function assessDataQuality(
  home: TeamFeatures,
  away: TeamFeatures,
  hasBookmakerOdds: boolean,
): DataQualityResult {
  const reasons: string[] = [];

  if (home.overall.played < MIN_PLAYED_FOR_FORM) reasons.push(`home team has only ${home.overall.played} recent results on file`);
  if (away.overall.played < MIN_PLAYED_FOR_FORM) reasons.push(`away team has only ${away.overall.played} recent results on file`);
  if (home.overall.goalsScoredAvg === null || home.overall.goalsConcededAvg === null) reasons.push("home team missing season goals average");
  if (away.overall.goalsScoredAvg === null || away.overall.goalsConcededAvg === null) reasons.push("away team missing season goals average");
  if (home.context.leaguePosition === null) reasons.push("home team missing league position");
  if (away.context.leaguePosition === null) reasons.push("away team missing league position");
  if (!home.home || !away.away) reasons.push("home/away split stats missing for one side");
  if (!hasBookmakerOdds) reasons.push("no bookmaker odds available yet");

  // INSUFFICIENT: cannot price at all — no odds means no edge/EV is
  // possible regardless of model quality, so this always dominates.
  if (!hasBookmakerOdds) {
    return { quality: "INSUFFICIENT", reasons };
  }

  const coreMissing = [
    home.overall.goalsScoredAvg === null,
    away.overall.goalsScoredAvg === null,
    home.overall.played < MIN_PLAYED_FOR_FORM,
    away.overall.played < MIN_PLAYED_FOR_FORM,
  ].filter(Boolean).length;

  if (coreMissing >= 2) {
    return { quality: "LOW", reasons };
  }
  if (reasons.length > 0) {
    return { quality: "MEDIUM", reasons };
  }
  return { quality: "HIGH", reasons: [] };
}
