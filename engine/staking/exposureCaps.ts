// FOUNDATION ONLY — see kelly.ts's header note. Not wired into any live path.

export interface ExposureLimits {
  maxDailyExposurePercent: number; // e.g. 0.35
  maxOpenExposurePercent: number; // e.g. 0.40
}

export const DEFAULT_EXPOSURE_LIMITS: ExposureLimits = {
  maxDailyExposurePercent: 0.35,
  maxOpenExposurePercent: 0.40,
};

export interface ExposureCheckInput {
  proposedStakePercent: number;
  alreadyCommittedTodayPercent: number;
  alreadyOpenPercent: number;
  limits?: ExposureLimits;
}

export type ExposureCheckResult = { allowed: true } | { allowed: false; reason: string };

export function checkExposureLimits(input: ExposureCheckInput): ExposureCheckResult {
  const limits = input.limits ?? DEFAULT_EXPOSURE_LIMITS;

  const projectedDaily = input.alreadyCommittedTodayPercent + input.proposedStakePercent;
  if (projectedDaily > limits.maxDailyExposurePercent) {
    return {
      allowed: false,
      reason: `projected daily exposure ${(projectedDaily * 100).toFixed(1)}% exceeds cap ${(limits.maxDailyExposurePercent * 100).toFixed(1)}%`,
    };
  }

  const projectedOpen = input.alreadyOpenPercent + input.proposedStakePercent;
  if (projectedOpen > limits.maxOpenExposurePercent) {
    return {
      allowed: false,
      reason: `projected open exposure ${(projectedOpen * 100).toFixed(1)}% exceeds cap ${(limits.maxOpenExposurePercent * 100).toFixed(1)}%`,
    };
  }

  return { allowed: true };
}

/**
 * Correlation penalty (Section 34 of the original master prompt): when two
 * candidates share the same match_id, they are not independent exposure —
 * this reduces the *effective* combined stake percent used for exposure
 * checks, rather than blocking the second bet outright.
 */
export function correlationAdjustedExposure(stakePercents: number[], sameMatchGroups: number[][]): number {
  const grouped = new Set(sameMatchGroups.flat());
  let total = 0;
  for (let i = 0; i < stakePercents.length; i++) {
    const pct = stakePercents[i] as number;
    total += grouped.has(i) ? pct * 0.5 : pct;
  }
  return total;
}
