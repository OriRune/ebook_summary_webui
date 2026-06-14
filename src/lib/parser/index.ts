/**
 * Parser entry points + the shared "(part N of M)" title-suffix pattern.
 *
 * PART_RE is the canonical marker (ported from parser.py) used across the
 * codebase to recognize subdivided-chapter sections: the parser appends it, the
 * ChapterContinuityTracker matches it to group parts, and the UI merge/rename
 * logic uses it to renumber. One definition, shared.
 */
import type { Section } from "@/types";
import { splitPlainText, detectTitleAuthorFromText, normalizeNewlines } from "./plaintext";
import { splitEpub, detectTitleAuthorEpub } from "./epub";
import { splitPdf, detectTitleAuthorPdf } from "./pdf";

export { PART_RE } from "@/lib/partRe";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".epub", ".pdf"] as const;

export {
  splitPlainText,
  splitEpub,
  splitPdf,
  detectTitleAuthorFromText,
  detectTitleAuthorEpub,
  detectTitleAuthorPdf,
  normalizeNewlines,
};

/** Lower-cased file extension including the leading dot (e.g. ".epub"). */
export function fileExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export function isSupportedExt(ext: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Dispatch ported from parser.py split_ebook. The caller supplies the file
 * extension plus whichever input the format needs: epub is parsed from a path
 * (epub2 requires one), pdf from raw bytes, plain text/markdown from a decoded
 * string.
 */
export async function splitEbook(
  ext: string,
  input: { text?: string; path?: string; buffer?: Buffer },
  maxChars = 9000
): Promise<Section[]> {
  if (ext === ".epub") {
    if (!input.path) throw new Error("EPUB parsing requires a file path.");
    return splitEpub(input.path, maxChars);
  }
  if (ext === ".pdf") {
    if (!input.buffer) throw new Error("PDF parsing requires file bytes.");
    return splitPdf(input.buffer, maxChars);
  }
  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    if (input.text === undefined) throw new Error("Text parsing requires decoded text.");
    return splitPlainText(input.text, maxChars);
  }
  throw new Error(`Unsupported file type: ${ext}. Supported: .txt, .md, .epub, .pdf`);
}

/** Title/author detection dispatch, ported from parser.py detect_title_author. */
export async function detectTitleAuthor(
  ext: string,
  input: { text?: string; path?: string; buffer?: Buffer }
): Promise<[string, string]> {
  if (ext === ".epub" && input.path) {
    return detectTitleAuthorEpub(input.path);
  }
  if (ext === ".pdf" && input.buffer) {
    return detectTitleAuthorPdf(input.buffer);
  }
  if ((ext === ".txt" || ext === ".md" || ext === ".markdown") && input.text !== undefined) {
    // Python reads only the first 40000 chars for detection.
    return detectTitleAuthorFromText(input.text.slice(0, 40000));
  }
  return ["", ""];
}
