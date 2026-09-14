// Pure functions only — Phase 2 spec, Section 7. Deliberately does NOT
// de-vig/overround-adjust `impliedProbability` into a "fair" probability by
// default (that's a separate, explicit step a caller can layer on) — Section
// 7 is explicit: "Do not call bookmaker implied probability 'fair
// probability.'" Keeping this module's naming honest about that distinction
// matters more than convenience here.

/** impliedProbability = 1 / odds. Throws on odds <= 1 (not a valid decimal price). */
export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) {
    throw new Error(`impliedProbability: odds must be > 1, got ${decimalOdds}`);
  }
  return 1 / decimalOdds;
}

/** edge = modelProbability - impliedProbability (Section 7). Can be negative. */
export function edge(modelProbability: number, impliedProb: number): number {
  return modelProbability - impliedProb;
}

/** EV = (modelProbability * odds) - 1 (Section 7) — expected return per unit staked. */
export function expectedValue(modelProbability: number, decimalOdds: number): number {
  return modelProbability * decimalOdds - 1;
}

export interface EdgeAndEv {
  impliedProbability: number;
  edge: number;
  ev: number;
}

/** Convenience wrapper computing all three from a model probability + odds. */
export function computeEdgeAndEv(modelProbability: number, decimalOdds: number): EdgeAndEv {
  const implied = impliedProbability(decimalOdds);
  return {
    impliedProbability: implied,
    edge: edge(modelProbability, implied),
    ev: expectedValue(modelProbability, decimalOdds),
  };
}

/**
 * Removes the bookmaker's overround from a *set* of mutually-exclusive
 * outcome odds (e.g. all three 1X2 prices) to get a proper fair-probability
 * estimate for each, rather than treating raw implied probability as fair.
 * This is the explicit, separate step Section 7 asks for — never applied
 * silently inside impliedProbability() itself.
 */
export function devigProbabilities(rawImpliedProbabilities: number[]): number[] {
  const overround = rawImpliedProbabilities.reduce((sum, p) => sum + p, 0);
  if (overround <= 0) {
    throw new Error("devigProbabilities: sum of implied probabilities must be > 0");
  }
  return rawImpliedProbabilities.map((p) => p / overround);
}
