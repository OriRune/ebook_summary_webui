/**
 * Rough run-cost estimation — pure arithmetic, no API calls. Ported from
 * llm_client.py estimate_run_cost with all constants reproduced exactly.
 *
 * Pricing is per-provider (USD per 1M tokens), looked up from the provider
 * registry, with optional per-model overrides for the common tiers. It's a
 * ballpark that updates live as options change, not a bill. Anthropic's Sonnet
 * list pricing ($3/M input, $15/M output) is the default fallback.
 */
import type { Backend, CostEstimate } from "@/types";
import { PROVIDERS } from "./providers";

// Default (Claude Sonnet list) — kept for back-compat with existing importers.
export const PRICE_PER_INPUT_TOKEN = 3.0 / 1_000_000;
export const PRICE_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;

/**
 * Per-model price overrides (USD per 1M tokens), matched by id substring. Rough,
 * editable ballparks — update as provider pricing changes. When no override
 * matches, the provider's default rate (from the registry) applies.
 */
const MODEL_PRICE_OVERRIDES: Array<{ match: string; input: number; output: number }> = [
  { match: "opus", input: 5.0, output: 25.0 },
  { match: "haiku", input: 1.0, output: 5.0 },
  { match: "gpt-4o-mini", input: 0.15, output: 0.6 },
  { match: "gpt-4.1-mini", input: 0.4, output: 1.6 },
  { match: "gpt-4.1-nano", input: 0.1, output: 0.4 },
  { match: "o4-mini", input: 1.1, output: 4.4 },
  { match: "gemini-2.5-flash", input: 0.3, output: 2.5 },
  { match: "gemini-1.5-flash", input: 0.075, output: 0.3 },
  { match: "gemini-2.5-pro", input: 1.25, output: 10.0 },
];

/** Resolve {input,output} USD-per-1M rates for a backend + model, or null. */
function ratesFor(backend: Backend, model: string): { input: number; output: number } | null {
  const lower = model.toLowerCase();
  for (const o of MODEL_PRICE_OVERRIDES) {
    if (lower.includes(o.match)) return { input: o.input, output: o.output };
  }
  const pricing = PROVIDERS[backend]?.pricing;
  if (pricing && pricing !== "free" && pricing !== "varies") return pricing;
  return null;
}

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

/**
 * USD estimate for a token count. Pass the backend + model to price against the
 * selected provider; defaults to Anthropic/Claude list pricing. Returns null
 * when the provider has no fixed rate (gateways/local) — the caller should show
 * guidance text instead of a number.
 */
export function estimateUsd(
  estimate: CostEstimate,
  backend: Backend = "anthropic",
  model = ""
): number | null {
  const rates = ratesFor(backend, model);
  if (!rates) return null;
  return (
    (estimate.inputTokens * rates.input + estimate.outputTokens * rates.output) / 1_000_000
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
