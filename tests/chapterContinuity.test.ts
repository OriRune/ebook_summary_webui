import { describe, it, expect } from "vitest";
import { ChapterContinuityTracker } from "@/lib/llm/chapterContinuity";

describe("ChapterContinuityTracker", () => {
  it("7.1 non-part title returns nothing and resets", () => {
    const t = new ChapterContinuityTracker();
    expect(t.contextFor("Chapter 5")).toEqual([null, null]);
  });

  it("7.2 first part of a split chapter — nothing to carry yet", () => {
    const t = new ChapterContinuityTracker();
    expect(t.contextFor("Chapter 5 (part 1 of 3)")).toEqual([null, null]);
  });

  it("7.3 later part receives earlier parts' output (cumulative)", () => {
    const t = new ChapterContinuityTracker();
    t.contextFor("Chapter 5 (part 1 of 3)");
    t.record("Chapter 5 (part 1 of 3)", ["Card A", "Card B"], ["Q1"]);
    t.contextFor("Chapter 5 (part 2 of 3)");
    t.record("Chapter 5 (part 2 of 3)", ["Card C"], []);
    const [fronts, questions] = t.contextFor("Chapter 5 (part 3 of 3)");
    expect(fronts).toEqual(["Card A", "Card B", "Card C"]);
    expect(questions).toEqual(["Q1"]);
  });

  it("7.4 resets at chapter boundary", () => {
    const t = new ChapterContinuityTracker();
    t.contextFor("Chapter 5 (part 1 of 2)");
    t.record("Chapter 5 (part 1 of 2)", ["X"], ["Y"]);
    expect(t.contextFor("Chapter 6 (part 1 of 2)")).toEqual([null, null]);
  });

  it("7.5 returns independent copies (mutation safety)", () => {
    const t = new ChapterContinuityTracker();
    t.contextFor("Chapter 1 (part 1 of 2)");
    t.record("Chapter 1 (part 1 of 2)", ["Real"], []);
    const [fronts] = t.contextFor("Chapter 1 (part 2 of 2)");
    fronts!.push("Tampered");
    const [frontsAgain] = t.contextFor("Chapter 1 (part 2 of 2)");
    expect(frontsAgain).toEqual(["Real"]);
  });
});
