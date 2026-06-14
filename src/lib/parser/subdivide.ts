/**
 * Section subdivision helpers, ported from parser.py
 * (_chunk_by_paragraphs / _subdivide_long_sections).
 */
import type { Section } from "@/types";
import { charCount } from "@/types";

/** Fallback: break text into roughly-equal chunks at paragraph boundaries. */
export function chunkByParagraphs(text: string, maxChars: number): Section[] {
  // Python: re.split(r'\n\s*\n', text) — split on blank-ish lines.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const p of paragraphs) {
    if (current.length > 0 && currentLen + p.length > maxChars) {
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
