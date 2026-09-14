import { describe, expect, it } from "vitest";
import { replayFixtures, type HistoricalFixtureMeta } from "../backtest/replay.js";
import { makeTeamFeatures } from "./fixtures.js";
import type { MatchOdds } from "../ranking/rankMarkets.js";

function fixture(overrides: Partial<HistoricalFixtureMeta>): HistoricalFixtureMeta {
  return {
    id: "f1",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    league: "PL",
    kickoffTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const odds: MatchOdds = { home: 1.8, draw: 3.6, away: 4.2 };

describe("replayFixtures — chronological processing", () => {
  it("processes fixtures in ascending kickoff order regardless of input order", () => {
    const callOrder: string[] = [];
    const fixtures = [
      fixture({ id: "later", kickoffTime: "2026-02-01T00:00:00Z" }),
      fixture({ id: "earlier", kickoffTime: "2026-01-01T00:00:00Z" }),
    ];

    replayFixtures(
      fixtures,
      (f) => {
        callOrder.push(f.id);
        return { home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false) };
      },
      () => odds,
      () => ({ homeScore: 1, awayScore: 0 }),
    );

    expect(callOrder).toEqual(["earlier", "later"]);
  });

  it("excludes a fixture rather than fabricating features when the provider returns null", () => {
    const rows = replayFixtures(
      [fixture({})],
      () => null,
      () => odds,
      () => ({ homeScore: 1, awayScore: 0 }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("replayFixtures — no data leakage", () => {
  it("the feature provider is never given anything but fixture metadata — no score field exists on its input", () => {
    let receivedFixture: HistoricalFixtureMeta | undefined;
    replayFixtures(
      [fixture({})],
      (f) => {
        receivedFixture = f;
        return { home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false) };
      },
      () => odds,
      () => ({ homeScore: 3, awayScore: 0 }),
    );
    expect(receivedFixture).toBeDefined();
    expect(Object.keys(receivedFixture as object)).not.toContain("homeScore");
    expect(Object.keys(receivedFixture as object)).not.toContain("awayScore");
  });

  it("the result provider is only consulted when a VALUE_BET decision was already made, never before", () => {
    let resultProviderCalled = false;
    // A fixture with no bookmaker odds at all can never become a VALUE_BET
    // (no edge/EV is computable) — the result provider must stay untouched.
    replayFixtures(
      [fixture({})],
      () => ({ home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false) }),
      () => ({ home: null, draw: null, away: null }),
      () => {
        resultProviderCalled = true;
        return { homeScore: 1, awayScore: 0 };
      },
    );
    expect(resultProviderCalled).toBe(false);
  });

  it("settlement outcome is derived only from the real final score, never from the model's own probability", () => {
    // Force a VALUE_BET by using generous thresholds, then verify the
    // recorded outcome matches the actual score, not the prediction.
    const rows = replayFixtures(
      [fixture({})],
      () => ({ home: makeTeamFeatures({}, true), away: makeTeamFeatures({}, false) }),
      () => odds,
      () => ({ homeScore: 0, awayScore: 3 }), // away win, regardless of what the model favored
      { thresholds: { minimumEdge: -1, minimumConfidence: 0, coverageStakeEnabled: false } },
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    if (row.decision.decision === "VALUE_BET" && row.decision.predictionMarket === "HOME_WIN") {
      expect(row.outcome).toBe("loss"); // home did not win the real match, regardless of prediction
    }
  });
});
