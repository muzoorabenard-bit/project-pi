import type { MatchClassification, ModelProbabilities } from "../types.js";

const STRONG_FAVOURITE_THRESHOLD = 0.6;
const BALANCED_BAND = 0.1; // |pHome - pAway| below this, with no other signal dominating
const DRAW_CANDIDATE_THRESHOLD = 0.28;
const GOAL_RICH_OVER25_THRESHOLD = 0.58;
const LOW_SCORING_UNDER_THRESHOLD = 0.58; // i.e. pOver25 <= 1 - this
const BTTS_CANDIDATE_THRESHOLD = 0.58;

/**
 * Pure classification — analytical information only (Phase 2 spec, Section
 * 5: "Classification is analytical information, not automatically a bet").
 * Returns every label that applies rather than forcing a single winner,
 * since a match can legitimately be e.g. both STRONG_FAVOURITE and
 * GOAL_RICH at once.
 */
export function classifyMatch(probs: ModelProbabilities): MatchClassification[] {
  const labels: MatchClassification[] = [];
  const pFav = Math.max(probs.pHome, probs.pAway);

  if (pFav >= STRONG_FAVOURITE_THRESHOLD) {
    labels.push("STRONG_FAVOURITE");
  } else if (Math.abs(probs.pHome - probs.pAway) <= BALANCED_BAND) {
    labels.push("BALANCED");
  }

  if (probs.pDraw >= DRAW_CANDIDATE_THRESHOLD) {
    labels.push("DRAW_CANDIDATE");
  }

  if (probs.pOver25 >= GOAL_RICH_OVER25_THRESHOLD) {
    labels.push("GOAL_RICH");
    labels.push("OVER_CANDIDATE");
  } else if (probs.pOver25 <= 1 - LOW_SCORING_UNDER_THRESHOLD) {
    labels.push("LOW_SCORING");
    labels.push("UNDER_CANDIDATE");
  }

  if (probs.pBtts >= BTTS_CANDIDATE_THRESHOLD) {
    labels.push("BTTS_CANDIDATE");
  }

  return labels;
}
