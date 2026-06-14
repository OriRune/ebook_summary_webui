/**
 * Anki CSV export, ported from exporter.py.
 *
 * Two flavors: Basic cards (cloze excluded) and Cloze cards (basic excluded),
 * since Anki needs each in its own note type. No header row; tags use "::" with
 * spaces replaced by underscores. Returns the CSV text plus the row count.
 */
import type { SectionResult } from "@/types";
import { isCloze } from "@/types";

function sectionTag(result: SectionResult, bookTitle: string): string {
  return (
    (bookTitle || "ebook").replace(/ /g, "_") + "::" + result.title.replace(/ /g, "_")
  );
}

/** Quote a CSV field the way Python's csv.writer (excel dialect) does. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function csvRows(rows: string[][]): string {
  // csv.writer terminates every row with \r\n (including the last).
  return rows.map((r) => r.map(csvField).join(",") + "\r\n").join("");
}

export function countClozeFlashcards(results: SectionResult[]): number {
  let count = 0;
  for (const r of results) {
    for (const c of r.flashcards) {
      if (isCloze(c)) count += 1;
    }
  }
  return count;
}

export interface CsvExport {
  content: string;
  count: number;
}

/** Basic cards (cloze excluded): columns front, back, tags. */
export function exportFlashcardsCsv(
  results: SectionResult[],
  bookTitle = ""
): CsvExport {
  const rows: string[][] = [];
  for (const result of results) {
    const tag = sectionTag(result, bookTitle);
    for (const card of result.flashcards) {
      if (isCloze(card)) continue;
      rows.push([card.front, card.back, tag]);
    }
  }
  return { content: csvRows(rows), count: rows.length };
}

/** Cloze cards (basic excluded): columns text, back_extra, tags. */
export function exportClozeFlashcardsCsv(
  results: SectionResult[],
  bookTitle = ""
): CsvExport {
  const rows: string[][] = [];
  for (const result of results) {
    const tag = sectionTag(result, bookTitle);
    for (const card of result.flashcards) {
      if (!isCloze(card)) continue;
      rows.push([card.front, card.back, tag]);
    }
  }
  return { content: csvRows(rows), count: rows.length };
}
