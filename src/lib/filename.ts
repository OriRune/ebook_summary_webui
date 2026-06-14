/**
 * Export filename helpers. The convention (spec.md §8): "{Author} - {Title}"
 * when both are set; otherwise just "{Title}", falling back to the uploaded
 * file's stem. Sanitization mirrors main.py _sanitize_filename_part.
 */

/** Strip filename-unsafe chars, then collapse whitespace runs to underscores. */
export function sanitizeFilenamePart(s: string): string {
  // Keep letters/numbers/underscore/space/hyphen (Unicode-aware, like Python \w).
  const cleaned = s.replace(/[^\p{L}\p{N}_\s-]/gu, "").trim();
  return cleaned.replace(/\s+/g, "_");
}

/** The default download basename (without extension) for a run. */
export function exportBasename(
  title: string,
  author: string,
  fileStem: string
): string {
  const t = title.trim();
  const a = author.trim();
  let base: string;
  if (t && a) {
    base = `${a} - ${t}`;
  } else if (t) {
    base = t;
  } else {
    base = fileStem;
  }
  return sanitizeFilenamePart(base) || "ebook";
}
