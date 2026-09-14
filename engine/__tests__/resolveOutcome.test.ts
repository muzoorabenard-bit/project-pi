import { describe, expect, it } from "vitest";
import { resolveOutcome } from "../backtest/resolveOutcome.js";

describe("resolveOutcome", () => {
  it("settles 1X2 markets from the real final score, not the prediction", () => {
    expect(resolveOutcome("HOME_WIN", "HOME", 2, 1)).toBe("win");
    expect(resolveOutcome("HOME_WIN", "HOME", 1, 2)).toBe("loss");
    expect(resolveOutcome("DRAW", "DRAW", 1, 1)).toBe("win");
    expect(resolveOutcome("DRAW", "DRAW", 1, 0)).toBe("loss");
    expect(resolveOutcome("AWAY_WIN", "AWAY", 0, 1)).toBe("win");
    expect(resolveOutcome("AWAY_WIN", "AWAY", 1, 1)).toBe("loss");
  });

  it("settles Double Chance markets", () => {
    expect(resolveOutcome("HOME_DRAW", "1X", 1, 1)).toBe("win");
    expect(resolveOutcome("HOME_DRAW", "1X", 0, 1)).toBe("loss");
    expect(resolveOutcome("HOME_AWAY", "12", 2, 1)).toBe("win");
    expect(resolveOutcome("HOME_AWAY", "12", 1, 1)).toBe("loss");
    expect(resolveOutcome("DRAW_AWAY", "X2", 1, 1)).toBe("win");
    expect(resolveOutcome("DRAW_AWAY", "X2", 2, 1)).toBe("loss");
  });

  it("settles goals markets on total goals, inclusive boundary handled correctly", () => {
    expect(resolveOutcome("OVER_1_5", "OVER", 1, 1)).toBe("win"); // 2 > 1.5
    expect(resolveOutcome("OVER_1_5", "OVER", 1, 0)).toBe("loss"); // 1 not > 1.5
    expect(resolveOutcome("OVER_2_5", "OVER", 2, 1)).toBe("win"); // 3 > 2.5
    expect(resolveOutcome("OVER_2_5", "OVER", 1, 1)).toBe("loss"); // 2 not > 2.5
    expect(resolveOutcome("UNDER_2_5", "UNDER", 1, 1)).toBe("win"); // 2 < 2.5
    expect(resolveOutcome("UNDER_2_5", "UNDER", 2, 1)).toBe("loss"); // 3 not < 2.5
  });

  it("settles BTTS from whether both teams actually scored", () => {
    expect(resolveOutcome("BTTS_YES", "YES", 1, 1)).toBe("win");
    expect(resolveOutcome("BTTS_YES", "YES", 1, 0)).toBe("loss");
    expect(resolveOutcome("BTTS_NO", "NO", 0, 2)).toBe("win");
    expect(resolveOutcome("BTTS_NO", "NO", 1, 1)).toBe("loss");
  });

  it("settles TEAM_GOALS per-side", () => {
    expect(resolveOutcome("TEAM_GOALS", "HOME_OVER_0_5", 1, 0)).toBe("win");
    expect(resolveOutcome("TEAM_GOALS", "HOME_OVER_0_5", 0, 3)).toBe("loss");
    expect(resolveOutcome("TEAM_GOALS", "AWAY_OVER_0_5", 0, 1)).toBe("win");
    expect(resolveOutcome("TEAM_GOALS", "AWAY_OVER_0_5", 3, 0)).toBe("loss");
  });

  it("throws on an unrecognized TEAM_GOALS selection rather than guessing", () => {
    expect(() => resolveOutcome("TEAM_GOALS", "NOT_A_REAL_SELECTION", 1, 0)).toThrow();
  });
});
