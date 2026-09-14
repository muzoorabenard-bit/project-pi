import { describe, expect, it } from "vitest";
import { checkLeakage } from "../backtest/leakageGuard.js";

describe("checkLeakage", () => {
  it("passes when every timestamp is at or before kickoff", () => {
    const result = checkLeakage({
      kickoff: "2026-09-14T16:30:00Z",
      featureSnapshotCapturedAt: "2026-09-14T05:02:00Z",
      oddsCapturedAt: "2026-09-14T13:35:00Z",
    });
    expect(result.status).toBe("OK");
  });

  it("passes when there are no odds at all (null) — nothing to leak-check", () => {
    const result = checkLeakage({
      kickoff: "2026-09-14T16:30:00Z",
      featureSnapshotCapturedAt: "2026-09-14T05:02:00Z",
      oddsCapturedAt: null,
    });
    expect(result.status).toBe("OK");
  });

  // The mandatory deliberate leakage test (spec Section 26): proves
  // post-kickoff information is rejected, not silently used.
  it("DELIBERATE LEAKAGE: rejects a feature snapshot captured after kickoff", () => {
    const result = checkLeakage({
      kickoff: "2026-09-14T16:30:00Z",
      featureSnapshotCapturedAt: "2026-09-14T18:00:00Z", // 90 minutes after kickoff
      oddsCapturedAt: null,
    });
    expect(result.status).toBe("LEAKAGE_DETECTED");
    expect(result.reason).toMatch(/feature_snapshot/i);
  });

  it("DELIBERATE LEAKAGE: rejects odds captured after kickoff even when the feature snapshot is clean", () => {
    const result = checkLeakage({
      kickoff: "2026-09-14T16:30:00Z",
      featureSnapshotCapturedAt: "2026-09-14T05:02:00Z",
      oddsCapturedAt: "2026-09-14T17:00:00Z", // in-play odds, not pre-match
    });
    expect(result.status).toBe("LEAKAGE_DETECTED");
    expect(result.reason).toMatch(/odds/i);
  });

  it("treats a snapshot captured exactly at kickoff as acceptable (boundary inclusive)", () => {
    const result = checkLeakage({
      kickoff: "2026-09-14T16:30:00Z",
      featureSnapshotCapturedAt: "2026-09-14T16:30:00Z",
      oddsCapturedAt: null,
    });
    expect(result.status).toBe("OK");
  });
});
