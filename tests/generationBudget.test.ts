import { describe, it, expect } from "vitest";
import { shouldStopForTime } from "@/lib/generationBudget";

const HARD = 60_000;
const SAFETY = 8000;

describe("shouldStopForTime", () => {
  it("always runs the first section (no average yet)", () => {
    expect(
      shouldStopForTime({ elapsedMs: 0, avgSectionMs: 0, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(false);
    // Even very late, with no average we still attempt one section.
    expect(
      shouldStopForTime({ elapsedMs: 59_000, avgSectionMs: 0, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(false);
  });

  it("keeps going when there is comfortable headroom", () => {
    // 10s elapsed, ~5s/section → est next 7.5s, well under 52s budget.
    expect(
      shouldStopForTime({ elapsedMs: 10_000, avgSectionMs: 5000, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(false);
  });

  it("stops when the next section would risk the cap", () => {
    // 45s elapsed, 8s/section → est next 12s → 57s > 52s budget.
    expect(
      shouldStopForTime({ elapsedMs: 45_000, avgSectionMs: 8000, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(true);
  });

  it("respects the safety headroom boundary", () => {
    // budget = 60000 - 8000 = 52000. est next = 1.5 * 6000 = 9000.
    // elapsed 43000 + 9000 = 52000 -> not strictly greater -> keep going.
    expect(
      shouldStopForTime({ elapsedMs: 43_000, avgSectionMs: 6000, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(false);
    // one ms more tips it over.
    expect(
      shouldStopForTime({ elapsedMs: 43_001, avgSectionMs: 6000, hardLimitMs: HARD, safetyMs: SAFETY })
    ).toBe(true);
  });
});
