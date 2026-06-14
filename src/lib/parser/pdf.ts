/**
 * PDF splitting, ported from parser.py split_pdf / _pdf_metadata.
 *
 * Strategy (priority order), matching the desktop pypdf logic:
 *   1. If the PDF has a bookmark/outline tree, use top-level bookmark titles as
 *      chapter boundaries (page ranges between consecutive bookmarks).
 *   2. Otherwise fall back to splitPlainText() on the joined page text.
 *
 * Throws if the PDF appears to be scanned (no extractable text on any page).
 *
 * pdf-parse (the chosen library) doesn't expose the document outline, so we
 * drive its *bundled* pdf.js engine directly — same engine pdf-parse uses
 * internally — to get both per-page text and the outline from one load.
 */
import { createRequire } from "node:module";
import type { Section } from "@/types";
import { splitPlainText } from "./plaintext";
import { subdivideLongSections } from "./subdivide";

const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadPdfjs(): any {
  // pdf-parse pins this build; mirror its DEFAULT_OPTIONS.version path.
  const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  if (pdfjs.disableWorker !== undefined) pdfjs.disableWorker = true;
  return pdfjs;
}

/** Per-page text extraction, replicating pdf-parse's render_page line logic. */
async function renderPage(page: any): Promise<string> {
  const textContent = await page.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === undefined) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = item.transform[5];
  }
  return text;
}

/** Resolve an outline entry's destination to a 0-based page index, or null. */
async function resolveDestPage(doc: any, dest: any): Promise<number | null> {
  try {
    let d = dest;
    if (typeof d === "string") {
      d = await doc.getDestination(d);
    }
    if (Array.isArray(d) && d.length > 0) {
      return await doc.getPageIndex(d[0]);
    }
    return null;
  } catch {
    return null;
  }
}

export async function splitPdf(buffer: Buffer, maxChars = 9000): Promise<Section[]> {
  const pdfjs = loadPdfjs();
  const doc = await pdfjs.getDocument(new Uint8Array(buffer));
  const numPages: number = doc.numPages;

  // --- extract text from every page ---
  const pageTexts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await doc.getPage(i);
      pageTexts.push(await renderPage(page));
    } catch {
      pageTexts.push("");
    }
  }

  // Detect scanned PDFs: if fewer than 10% of pages have any text at all, the
  // PDF is almost certainly images-only and we can't process it.
  const nonEmpty = pageTexts.filter((t) => t.trim()).length;
  if (pageTexts.length > 0 && nonEmpty / pageTexts.length < 0.1) {
    throw new Error(
      "This PDF appears to be a scanned document (no extractable text found). " +
        "Only born-digital PDFs are supported. To use a scanned PDF, first run " +
        "it through an OCR tool to produce a searchable PDF or a plain text file."
    );
  }

  // --- try to use the PDF outline (bookmarks) for chapter boundaries ---
  let sections: Section[] | null = null;
  try {
    const outline = await doc.getOutline();
    if (Array.isArray(outline) && outline.length > 0) {
      // Only top-level entries become chapters (matches the desktop behavior of
      // skipping nested sub-headings).
      const flatBookmarks: Array<{ title: string; page: number }> = [];
      for (const entry of outline) {
        const page = await resolveDestPage(doc, entry.dest);
        if (page !== null) {
          flatBookmarks.push({ title: (entry.title || "").trim(), page });
        }
      }

      if (flatBookmarks.length >= 2) {
        const bmSections: Section[] = [];
        flatBookmarks.forEach((bm, i) => {
          const endPage =
            i + 1 < flatBookmarks.length ? flatBookmarks[i + 1].page : pageTexts.length;
          const body = pageTexts
            .slice(bm.page, endPage)
            .map((t) => t.trim())
            .filter((t) => t)
            .join("\n\n");
          if (body) {
            bmSections.push({ title: bm.title || `Section ${i + 1}`, text: body });
          }
        });
        if (bmSections.length >= 2) {
          sections = bmSections;
        }
      }
    }
  } catch {
    // Outline parsing failed or absent — fall through to text-based split.
  }

  // --- fall back to heading-regex / paragraph-chunk split ---
  if (sections === null) {
    const fullText = pageTexts
      .map((t) => t)
      .filter((t) => t.trim())
      .join("\n\n");
    // splitPlainText already subdivides oversized sections.
    return splitPlainText(fullText, maxChars);
  }

  return subdivideLongSections(sections, maxChars);
}

export async function detectTitleAuthorPdf(buffer: Buffer): Promise<[string, string]> {
  try {
    const pdfjs = loadPdfjs();
    const doc = await pdfjs.getDocument(new Uint8Array(buffer));
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta && meta.info) || {};
    const title = (info.Title || "").trim();
    const author = (info.Author || "").trim();
    return [title, author];
  } catch {
    return ["", ""];
  }
}
