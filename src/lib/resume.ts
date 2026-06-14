/**
 * Resume / skip helpers, ported from main.py _on_generate. Every Generate click
 * is a resume: sections with a successful result are skipped, and character
 * notes + the last good rolling context are reconstructed from prior results so
 * the new run picks up where the last left off.
 */
import type { CharacterNote, Section, SectionResult } from "@/types";

/** Indices to (re)process: checked sections without an existing success. */
export function toProcessIndices(
  checkedIndices: number[],
  results: Record<number, SectionResult>
): number[] {
  return checkedIndices.filter((i) => !(results[i] && !results[i].error));
}

/** Sorted successful result indices. */
function doneIndices(results: Record<number, SectionResult>): number[] {
  return Object.keys(results)
    .map(Number)
    .filter((i) => !results[i].error)
    .sort((a, b) => a - b);
}

/** Per-section character notes from prior successful results, in index order. */
export function reconstructInitialNotes(
  sections: Section[],
  results: Record<number, SectionResult>
): Array<[string, CharacterNote[]]> {
  return doneIndices(results)
    .filter((i) => results[i].characterNotes.length > 0)
    .map((i) => [sections[i].title, results[i].characterNotes]);
}

/** The last successful context digest (in index order), or null. */
export function reconstructInitialContext(
  results: Record<number, SectionResult>
): string | null {
  let ctx: string | null = null;
  for (const i of doneIndices(results)) {
    if (results[i].contextDigest) ctx = results[i].contextDigest;
  }
  return ctx;
}
