/**
 * Section subdivision helpers, ported from parser.py
 * (_chunk_by_paragraphs / _subdivide_long_sections).
 */
import type { Section } from "@/types";
import { charCount } from "@/types";

/**
 * Break text into balanced chunks at paragraph boundaries.
 *
 * Rather than greedily packing each chunk to `maxChars` (which leaves a small,
 * lopsided trailing chunk), we first decide how many chunks are needed —
 * `ceil(total / maxChars)` — then aim for an even target size of
 * `total / chunkCount` per chunk. This keeps chunks within the same chapter
 * close to the same size and avoids a tiny leftover at the end, while a hard
 * `maxChars` guard guarantees no chunk ever exceeds the LLM-context limit.
 */
export function chunkByParagraphs(text: string, maxChars: number): Section[] {
  // Python: re.split(r'\n\s*\n', text) — split on blank-ish lines.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  // Total length as it will appear once paragraphs are re-joined with "\n\n".
  const totalLen =
    paragraphs.reduce((sum, p) => sum + p.length, 0) +
    (paragraphs.length - 1) * 2;
  const chunkCount = Math.max(1, Math.ceil(totalLen / maxChars));
  const target = totalLen / chunkCount;

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const p of paragraphs) {
    // Hard cap: never let a chunk exceed maxChars.
    const wouldExceedMax = current.length > 0 && currentLen + p.length > maxChars;
    // Soft target: once a chunk has reached its even share, start the next one
    // (but keep room for the remaining chunks so we don't overshoot the count).
    const reachedTarget =
      current.length > 0 &&
      currentLen >= target &&
      chunks.length < chunkCount - 1;

    if (wouldExceedMax || reachedTarget) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(p);
    currentLen += p.length + 2;
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.map((chunk, i) => ({ title: `Part ${i + 1}`, text: chunk }));
}

/**
 * If any detected section is still too large for an LLM pass, split it further
 * at paragraph boundaries, keeping the original title with a "(part N of M)"
 * suffix.
 */
export function subdivideLongSections(
  sections: Section[],
  maxChars: number
): Section[] {
  const result: Section[] = [];
  for (const sec of sections) {
    if (charCount(sec) <= maxChars) {
      result.push(sec);
      continue;
    }
    const subChunks = chunkByParagraphs(sec.text, maxChars);
    if (subChunks.length <= 1) {
      result.push(sec);
      continue;
    }
    subChunks.forEach((sub, i) => {
      result.push({
        title: `${sec.title} (part ${i + 1} of ${subChunks.length})`,
        text: sub.text,
      });
    });
  }
  return result;
}
