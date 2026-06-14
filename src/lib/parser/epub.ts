/**
 * EPUB splitting, ported from parser.py split_epub / _epub_metadata.
 *
 * Iterates the spine (reading order), extracts each document's text, skips
 * tiny items (covers/TOC/nav), and titles each section from its first
 * h1/h2/h3 — falling back to "Section N". Oversized sections are subdivided.
 */
import type { Section } from "@/types";
import { EPub } from "epub2";
import { convert } from "html-to-text";
import { subdivideLongSections } from "./subdivide";

/**
 * HTML → plain text, approximating BeautifulSoup's get_text('\n'): no
 * wordwrap, drop images, drop link targets, and keep headings as plain blocks
 * (html-to-text would otherwise upper-case / underline them).
 */
function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      { selector: "h1", format: "block" },
      { selector: "h2", format: "block" },
      { selector: "h3", format: "block" },
      { selector: "h4", format: "block" },
      { selector: "h5", format: "block" },
      { selector: "h6", format: "block" },
    ],
  });
}

/** Text of the first <h1>/<h2>/<h3> in document order, or "" if none. */
function firstHeading(html: string): string {
  const m = /<h([123])[^>]*>([\s\S]*?)<\/h\1>/i.exec(html);
  if (!m) return "";
  return htmlToText(m[0]).trim();
}

export async function splitEpub(path: string, maxChars = 9000): Promise<Section[]> {
  const book = await EPub.createAsync(path);

  const sections: Section[] = [];
  for (const item of book.flow) {
    if (!item.id) continue;
    let raw: string;
    try {
      raw = await book.getChapterRawAsync(item.id);
    } catch {
      continue; // non-document item or unreadable — skip, like the Python path
    }
    let text = htmlToText(raw);
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 200) {
      continue; // skip covers, TOC pages, nav, etc.
    }
    const title = firstHeading(raw) || `Section ${sections.length + 1}`;
    sections.push({ title, text });
  }

  return subdivideLongSections(sections, maxChars);
}

export async function detectTitleAuthorEpub(path: string): Promise<[string, string]> {
  try {
    const book = await EPub.createAsync(path);
    const title = (book.metadata.title || "").trim();
    const author = (book.metadata.creator || "").trim();
    return [title, author];
  } catch {
    return ["", ""];
  }
}
