/**
 * Word (.docx) study-guide export, ported from exporter.py export_summaries_docx.
 * Same logical structure as the Markdown export, rendered with real Word styles:
 * Title / Heading 1, bold labels, bullet lists, italic runs.
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import type { CharacterSummary, SectionResult } from "@/types";
import { isCloze } from "@/types";

function uniqueModels(results: SectionResult[]): string[] {
  const used = results.filter((r) => !r.error && r.modelUsed).map((r) => r.modelUsed);
  return Array.from(new Set(used)).sort();
}

const bullet = { level: 0 } as const;

export async function exportSummariesDocx(
  results: SectionResult[],
  bookTitle = "",
  characterList: CharacterSummary[] | null = null
): Promise<Buffer> {
  const unique = uniqueModels(results);
  const children: Paragraph[] = [];

  if (bookTitle) {
    children.push(
      new Paragraph({ text: `${bookTitle} — Study Guide`, heading: HeadingLevel.TITLE })
    );
  }

  if (unique.length === 1) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `Generated with: ${unique[0]}`, italics: true })] })
    );
  } else if (unique.length > 1) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Generated with multiple models: ${unique.join(", ")}`, italics: true }),
        ],
      })
    );
  }

  if (characterList && characterList.length > 0) {
    children.push(new Paragraph({ text: "Main Characters", heading: HeadingLevel.HEADING_1 }));
    for (const character of characterList) {
      children.push(new Paragraph({ children: [new TextRun({ text: character.name, bold: true })] }));
      children.push(new Paragraph({ text: character.summary }));
    }
  }

  for (const result of results) {
    children.push(new Paragraph({ text: result.title, heading: HeadingLevel.HEADING_1 }));
    if (result.error) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Generation failed: ${result.error}`, italics: true })],
        })
      );
      continue;
    }
    if (unique.length > 1 && result.modelUsed) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `Model: ${result.modelUsed}`, italics: true })] })
      );
    }
    if (result.summary) {
      children.push(new Paragraph({ text: result.summary }));
    }
    if (result.flashcards.length > 0) {
      const basic = result.flashcards.filter((c) => !isCloze(c));
      const cloze = result.flashcards.filter((c) => isCloze(c));
      if (basic.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Flashcards:", bold: true })] }));
        for (const card of basic) {
          children.push(
            new Paragraph({
              bullet,
              children: [new TextRun({ text: "Q: ", bold: true }), new TextRun({ text: card.front })],
            })
          );
          children.push(
            new Paragraph({
              bullet,
              children: [new TextRun({ text: "A: ", bold: true }), new TextRun({ text: card.back })],
            })
          );
        }
      }
      if (cloze.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Cloze cards:", bold: true })] }));
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text:
                  "(Anki fill-in-the-blank style — the {{c1::...}} portion " +
                  "is the part you'd be asked to recall)",
                italics: true,
              }),
            ],
          })
        );
        for (const card of cloze) {
          children.push(new Paragraph({ text: card.front, bullet }));
          if (card.back) {
            children.push(new Paragraph({ children: [new TextRun({ text: card.back, italics: true })] }));
          }
        }
      }
    }
    if (result.discussionQuestions.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Discussion questions:", bold: true })] })
      );
      for (const question of result.discussionQuestions) {
        children.push(new Paragraph({ text: question, bullet }));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
