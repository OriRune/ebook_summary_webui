import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { splitPdf } from "@/lib/parser/pdf";

async function bornDigitalPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines = [
    "Chapter 1",
    "ZEBRAFISHTOKEN is a distinctive marker word.",
    "This is born-digital PDF text that should be extractable by pdf.js.",
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: 720 - i * 24, size: 12, font });
  });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function scannedPdf(): Promise<Buffer> {
  // A page with no text layer (only a drawn rectangle) — mimics a scanned image PDF.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 100, y: 100, width: 200, height: 200 });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("PDF parser (fixture)", () => {
  it("extracts text from a born-digital PDF into sections", async () => {
    const sections = await splitPdf(await bornDigitalPdf());
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const allText = sections.map((s) => s.text).join("\n");
    expect(allText).toContain("ZEBRAFISHTOKEN");
  });

  it("1.7 rejects a scanned (text-less) PDF", async () => {
    await expect(splitPdf(await scannedPdf())).rejects.toThrow(/scanned document/i);
  });
});
