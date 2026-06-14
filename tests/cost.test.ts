import { describe, it, expect } from "vitest";
import { estimateRunCost } from "@/lib/llm/cost";

const base = {
  wantSummary: true,
  wantFlashcards: true,
  wantDiscussion: false,
  wantCharacterList: false,
  wantContextDigest: false,
  wantChapterContinuity: false,
};

describe("estimateRunCost", () => {
  it("8.1 empty selection → zero", () => {
    expect(estimateRunCost([], base)).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("8.2 no content requested → zero", () => {
    const est = estimateRunCost([5000], {
      wantSummary: false,
      wantFlashcards: false,
      wantDiscussion: false,
      wantCharacterList: true,
      wantContextDigest: false,
      wantChapterContinuity: false,
    });
    expect(est).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("8.3 rolling context only bumps non-first sections (~110 each)", () => {
    const without = estimateRunCost([5000, 5000, 5000], base);
    const withCtx = estimateRunCost([5000, 5000, 5000], {
      ...base,
      wantContextDigest: true,
    });
    // 2 non-first sections × 110 input bump; output rises by the context_digest
    // per-feature estimate (110 × 3 sections), but input delta isolates the bump.
    expect(withCtx.inputTokens - without.inputTokens).toBe(2 * 110);
  });

  it("8.4 chapter continuity additive with context digest", () => {
    const ctxOnly = estimateRunCost([5000, 5000], { ...base, wantContextDigest: true });
    const both = estimateRunCost([5000, 5000], {
      ...base,
      wantContextDigest: true,
      wantChapterContinuity: true,
    });
    expect(both.inputTokens - ctxOnly.inputTokens).toBe(90); // one non-first section
    expect(both.outputTokens).toBe(ctxOnly.outputTokens);
  });

  it("8.5 character list adds one consolidation block", () => {
    const without = estimateRunCost([5000, 5000], base);
    const withChar = estimateRunCost([5000, 5000], { ...base, wantCharacterList: true });
    // input: 2*120 + 300 consolidation, plus 240 character_notes output per section
    expect(withChar.inputTokens - without.inputTokens).toBe(2 * 120 + 300);
    expect(withChar.outputTokens - without.outputTokens).toBe(2 * 240 + 4096);
  });
});
