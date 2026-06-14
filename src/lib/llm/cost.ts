/**
 * Rough run-cost estimation — pure arithmetic, no API calls. Ported from
 * llm_client.py estimate_run_cost with all constants reproduced exactly.
 *
 * Pricing is Claude Sonnet 4.6 list pricing as of mid-2026 ($3/M input,
 * $15/M output). It's a ballpark that updates live as options change, not a bill.
 */
import type { CostEstimate } from "@/types";

export const PRICE_PER_INPUT_TOKEN = 3.0 / 1_000_000;
export const PRICE_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;

const CHARS_PER_TOKEN = 3.5;

const SECTION_MAX_OUTPUT_TOKENS = 4096;
const CONSOLIDATION_MAX_OUTPUT_TOKENS = 4096;

const PROMPT_OVERHEAD_TOKENS = 400;

const OUTPUT_TOKENS_PER_FEATURE = {
  summary: 220,
  flashcards: 340,
  discussion: 90,
  character_notes: 240,
  context_digest: 110,
} as const;

const CONSOLIDATION_INPUT_PER_SECTION_TOKENS = 120;
const CONSOLIDATION_INPUT_OVERHEAD_TOKENS = 300;

const CONTEXT_DIGEST_INPUT_TOKENS = 110;
const CHAPTER_CONTINUITY_INPUT_TOKENS = 90;

export function totalTokens(estimate: CostEstimate): number {
  return estimate.inputTokens + estimate.outputTokens;
}

export function estimateUsd(estimate: CostEstimate): number {
  return (
    estimate.inputTokens * PRICE_PER_INPUT_TOKEN +
    estimate.outputTokens * PRICE_PER_OUTPUT_TOKEN
  );
}

export interface EstimateRunCostOptions {
  wantSummary: boolean;
  wantFlashcards: boolean;
  wantDiscussion: boolean;
  wantCharacterList: boolean;
  wantContextDigest?: boolean;
  wantChapterContinuity?: boolean;
}

export function estimateRunCost(
  sectionCharCounts: number[],
  {
    wantSummary,
    wantFlashcards,
    wantDiscussion,
    wantCharacterList,
    wantContextDigest = false,
    wantChapterContinuity = false,
  }: EstimateRunCostOptions
): CostEstimate {
  const n = sectionCharCounts.length;
  if (n === 0 || !(wantSummary || wantFlashcards || wantDiscussion)) {
    // Nothing would be sent: no sections, or no content type requested
    // (character list alone can't run — it rides on per-section content calls).
    return { inputTokens: 0, outputTokens: 0 };
  }

  let perSectionOutput = 0;
  if (wantSummary) perSectionOutput += OUTPUT_TOKENS_PER_FEATURE.summary;
  if (wantFlashcards) perSectionOutput += OUTPUT_TOKENS_PER_FEATURE.flashcards;
  if (wantDiscussion) perSectionOutput += OUTPUT_TOKENS_PER_FEATURE.discussion;
  if (wantCharacterList) perSectionOutput += OUTPUT_TOKENS_PER_FEATURE.character_notes;
  if (wantContextDigest) perSectionOutput += OUTPUT_TOKENS_PER_FEATURE.context_digest;
  perSectionOutput = Math.min(perSectionOutput, SECTION_MAX_OUTPUT_TOKENS);

  let inputTokens = 0;
  let outputTokens = 0;
  for (let i = 0; i < n; i++) {
    const chars = sectionCharCounts[i];
    let extraInput = 0;
    if (wantContextDigest && i > 0) {
      extraInput = CONTEXT_DIGEST_INPUT_TOKENS;
    }
    if (wantChapterContinuity && i > 0) {
      extraInput += CHAPTER_CONTINUITY_INPUT_TOKENS;
    }
    inputTokens += Math.trunc(chars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS + extraInput;
    outputTokens += perSectionOutput;
  }

  if (wantCharacterList) {
    inputTokens +=
      n * CONSOLIDATION_INPUT_PER_SECTION_TOKENS + CONSOLIDATION_INPUT_OVERHEAD_TOKENS;
    outputTokens += CONSOLIDATION_MAX_OUTPUT_TOKENS;
  }

  return { inputTokens, outputTokens };
}
