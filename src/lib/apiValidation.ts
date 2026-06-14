/**
 * Lightweight runtime validation for API route request bodies. The app is a
 * public, unauthenticated BYOK proxy, so every route validates its input shape
 * and returns a 400 (not a 500) on anything malformed or oversized. Dependency-free
 * type guards — kept deliberately small.
 */
import type { Backend, GenerateOptions, Section } from "@/types";

// Defensive caps (a single generate request carries the sections to process).
const MAX_SECTIONS = 5000;
const MAX_SECTION_CHARS = 2_000_000; // ~2 MB of text per section is already extreme

const BACKENDS: Backend[] = ["anthropic", "ollama", "groq"];
const CONTENT_TYPES = ["auto", "fiction", "nonfiction"];
const EXPORT_KINDS = ["csv", "cloze", "md", "docx", "char", "context"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSection(v: unknown): v is Section {
  return isObject(v) && typeof v.title === "string" && typeof v.text === "string";
}

export function isSections(v: unknown): v is Section[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_SECTIONS &&
    v.every((s) => isSection(s) && s.text.length <= MAX_SECTION_CHARS)
  );
}

function isOptions(v: unknown): v is GenerateOptions {
  return (
    isObject(v) &&
    typeof v.includeSummary === "boolean" &&
    typeof v.includeFlashcards === "boolean" &&
    typeof v.includeDiscussion === "boolean" &&
    typeof v.includeCharacterList === "boolean" &&
    typeof v.includeContextDigest === "boolean" &&
    typeof v.contentType === "string" &&
    CONTENT_TYPES.includes(v.contentType)
  );
}

export function isBackend(v: unknown): v is Backend {
  return typeof v === "string" && (BACKENDS as string[]).includes(v);
}

export function isExportKind(v: unknown): boolean {
  return typeof v === "string" && EXPORT_KINDS.includes(v);
}

/** Validates the /api/generate body. Returns an error string, or null if valid. */
export function validateGenerateBody(v: unknown): string | null {
  if (!isObject(v)) return "Invalid request body.";
  if (!isSections(v.sections)) return "Invalid or oversized 'sections'.";
  if (
    !Array.isArray(v.toProcess) ||
    v.toProcess.length > MAX_SECTIONS ||
    !v.toProcess.every(
      (i) => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < (v.sections as Section[]).length
    )
  ) {
    return "Invalid 'toProcess' indices.";
  }
  if (!isOptions(v.options)) return "Invalid 'options'.";
  if (!isBackend(v.backend)) return "Invalid 'backend'.";
  return null;
}

/** Validates the /api/export body. Returns an error string, or null if valid. */
export function validateExportBody(v: unknown): string | null {
  if (!isObject(v)) return "Invalid request body.";
  if (!isExportKind(v.kind)) return "Invalid export 'kind'.";
  if (!Array.isArray(v.results)) return "Invalid 'results'.";
  return null;
}
