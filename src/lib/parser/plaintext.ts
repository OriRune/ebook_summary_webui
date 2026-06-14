/**
 * Plain-text / markdown splitting, ported from parser.py.
 *
 * Strategy: strip Project Gutenberg boilerplate, try to split on detected
 * chapter/section headings, fall back to paragraph chunking, then subdivide any
 * oversized section.
 */
import type { Section } from "@/types";
import { subdivideLongSections, chunkByParagraphs } from "./subdivide";

/**
 * Heading patterns that mark the start of a new chapter/section. Checked
 * against each stripped line. Ported verbatim from parser.py _HEADING_PATTERNS.
 */
const HEADING_PATTERNS: RegExp[] = [
  // "CHAPTER I", "Chapter 1", "Chapter One", "CHAPTER 12: The Storm"
  /^(chapter|chap\.?)\s+([ivxlcdm]+|\d+|[a-z-]+)\b/i,
  // "PART ONE", "Part 1", "Book II"
  /^(part|book|section|act)\s+([ivxlcdm]+|\d+|[a-z-]+)\b/i,
  // Markdown headings: "## Chapter I", "# Introduction", "### 3. Methods"
  /^#{1,3}\s+\S/,
  // Valid Roman numeral alone on its own line: "XIV", "IV.", "III".
  // Strict (and case-sensitive, like the Python original) so plain words such
  // as "LIVID" or "MILD" don't false-match — the trailing $ requires the whole
  // line to parse as a numeral.
  /^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\.?\s*$/,
  // Plain numbered headings: "1. Introduction", "12 Background"
  /^\d{1,3}[.)]\s+\S/,
];

// Markers used by Project Gutenberg / similar sources to bound the real text.
const START_MARKER = /\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG/i;
const END_MARKER = /\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i;

/** Normalize universal newlines, mirroring Python's text-mode file reads. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Trim Project Gutenberg (or similar) front/back matter if present. */
export function stripBoilerplate(text: string): string {
  let out = text;
  const start = START_MARKER.exec(out);
  if (start) {
    // Skip to the end of that marker line.
    out = out.slice(start.index + start[0].length);
    const nl = out.indexOf("\n");
    if (nl !== -1) {
      out = out.slice(nl + 1);
    }
  }
  const end = END_MARKER.exec(out);
  if (end) {
    out = out.slice(0, end.index);
  }
  return out.trim();
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  return HEADING_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Try to split on detected chapter/section headings. Returns null if too few
 * headings were found to be a meaningful split.
 */
function splitOnHeadings(text: string): Section[] | null {
  const lines = text.split("\n");
  const headingIdxs: number[] = [];
  lines.forEach((ln, i) => {
    if (looksLikeHeading(ln)) headingIdxs.push(i);
  });

  // Require at least 2 headings, and that they're not basically every line.
  if (headingIdxs.length < 2 || headingIdxs.length > lines.length * 0.5) {
    return null;
  }

  const sections: Section[] = [];
  headingIdxs.forEach((idx, n) => {
    const title = lines[idx].trim().replace(/^#+/, "").trim();
    const end = n + 1 < headingIdxs.length ? headingIdxs[n + 1] : lines.length;
    const body = lines.slice(idx + 1, end).join("\n").trim();
    if (body) {
      sections.push({ title: title || `Section ${n + 1}`, text: body });
    }
  });

  // If headings only produced one real section, detection was probably noise.
  if (sections.length < 2) {
    return null;
  }
  return sections;
}

export function splitPlainText(text: string, maxChars = 9000): Section[] {
  const normalized = stripBoilerplate(normalizeNewlines(text));
  let sections = splitOnHeadings(normalized);
  if (sections === null) {
    sections = chunkByParagraphs(normalized, maxChars);
  }
  return subdivideLongSections(sections, maxChars);
}

// ------------------------------------------------------------ title / author

// Project Gutenberg-style metadata lines: "**Title**: Wuthering Heights".
const TITLE_LINE = /^\*{0,2}Title\*{0,2}\s*:\s*(.+?)\*{0,2}\s*$/i;
const AUTHOR_LINE = /^\*{0,2}Author\*{0,2}\s*:\s*(.+?)\*{0,2}\s*$/i;
// "by Emily Brontë" lines (often immediately under a title heading).
const BY_LINE = /^#{0,3}\s*by\s+(.+?)\s*$/i;
// Markdown heading: capture the marker depth and the heading text.
const MD_HEADING = /^(#{1,2})\s+(.+?)\s*$/;
const CHAPTER_LIKE = /^(chapter|chap\.?|part|book|section|act)\b/i;

/**
 * Best-effort scan for a title/author from plain text. Returns "" for parts
 * that can't be determined confidently — callers fall back sensibly.
 */
export function detectTitleAuthorFromText(text: string): [string, string] {
  let title = "";
  let author = "";

  const allLines = normalizeNewlines(text).split("\n");

  // Pass 1: explicit "Title: ..." / "Author: ..." metadata lines.
  for (const raw of allLines.slice(0, 300)) {
    const line = raw.trim();
    if (!title) {
      const m = TITLE_LINE.exec(line);
      if (m) title = m[1].trim();
    }
    if (!author) {
      const m = AUTHOR_LINE.exec(line);
      if (m) author = m[1].trim();
    }
    if (title && author) {
      return [title, author];
    }
  }

  // Pass 2: a markdown heading near the top, optionally followed within a
  // couple lines by a "by AUTHOR NAME" line.
  const body = stripBoilerplate(normalizeNewlines(text));
  const nonblank = body
    .split("\n")
    .map((ln) => ln.trim())
    .filter((ln) => ln.length > 0);

  for (let i = 0; i < Math.min(nonblank.length, 20); i++) {
    const m = MD_HEADING.exec(nonblank[i]);
    if (!m) continue;
    const candidate = m[2].trim();
    if (CHAPTER_LIKE.test(candidate)) {
      continue; // this heading is a chapter/part marker, not a title
    }
    if (!title) {
      title = candidate;
      for (const nxt of nonblank.slice(i + 1, i + 4)) {
        const bm = BY_LINE.exec(nxt);
        if (bm) {
          author = bm[1].trim();
          break;
        }
      }
      break;
    }
  }

  return [title, author];
}
