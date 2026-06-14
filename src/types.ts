/**
 * Core data contracts, ported 1:1 from the desktop app's Python dataclasses
 * (see handoff/data-model.md). These are the canonical shapes shared between
 * the parser, the LLM layer, the exporters, the API routes, and the React UI.
 *
 * Python used snake_case; the TS side uses camelCase throughout.
 */

// ----------------------------------------------------------------- parser

/** One chapter or chunk of the ebook, sized to fit an LLM context window. */
export interface Section {
  title: string;
  text: string;
}

/** Derived helpers — Python exposed these as @property on Section. */
export function charCount(section: Section): number {
  return section.text.length;
}

/** Word count: Python's len(text.split()) splits on any whitespace run. */
export function wordCount(section: Section): number {
  const trimmed = section.text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// -------------------------------------------------------------------- LLM

export type CardType = "basic" | "cloze";

export interface Flashcard {
  /** Question, prompt, or cloze sentence (with {{c1::...}} markup). */
  front: string;
  /** Answer, or optional extra context for a cloze card (may be empty). */
  back: string;
  cardType: CardType;
}

export function isCloze(card: Flashcard): boolean {
  return card.cardType === "cloze";
}

/** Raw, section-scoped observation gathered during generation. */
export interface CharacterNote {
  name: string;
  note: string;
}

/** Finished, full-book character entry from the consolidation call. */
export interface CharacterSummary {
  name: string;
  summary: string;
}

/** The complete output for one section call. */
export interface SectionResult {
  title: string;
  summary: string;
  flashcards: Flashcard[];
  discussionQuestions: string[];
  characterNotes: CharacterNote[];
  /** Rolling "story so far" recap; empty unless context digest requested. */
  contextDigest: string;
  /** Set on any failure; other fields stay empty/default. */
  error: string | null;
  /** e.g. "claude-sonnet-4-6 (Anthropic API)"; empty on error. */
  modelUsed: string;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
}

export function totalTokens(estimate: CostEstimate): number {
  return estimate.inputTokens + estimate.outputTokens;
}

// ------------------------------------------------------------- options/config

/** content_type values mirror the desktop selector. */
export type ContentType = "auto" | "fiction" | "nonfiction";

export type Backend = "anthropic" | "ollama" | "groq";

/** What the user asked to generate for a run. */
export interface GenerateOptions {
  includeSummary: boolean;
  includeFlashcards: boolean;
  includeDiscussion: boolean;
  /** Per-section character notes + end-of-run consolidation call. */
  includeCharacterList: boolean;
  /** Rolling "carry story context forward" digest. */
  includeContextDigest: boolean;
  contentType: ContentType;
}

/** Backend selection + credentials for a run (keys are user-supplied). */
export interface BackendConfig {
  backend: Backend;
  model: string;
  /** Anthropic or Groq key; empty/ignored for Ollama. */
  apiKey: string;
}

/** Human-readable backend labels, matching the desktop _BACKEND_LABELS. */
export const BACKEND_LABELS: Record<Backend, string> = {
  anthropic: "Anthropic API",
  ollama: "Ollama",
  groq: "Groq",
};
