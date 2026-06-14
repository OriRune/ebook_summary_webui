import { describe, it, expect } from "vitest";
import type { Flashcard, SectionResult } from "@/types";
import { isCloze } from "@/types";
import {
  exportFlashcardsCsv,
  exportClozeFlashcardsCsv,
  countClozeFlashcards,
} from "@/lib/export/csv";
import { exportSummariesMarkdown } from "@/lib/export/markdown";
import { exportSummariesDocx } from "@/lib/export/docx";

function card(p: Partial<Flashcard>): Flashcard {
  return { front: "Q", back: "A", cardType: "basic", ...p };
}

function res(p: Partial<SectionResult>): SectionResult {
  return {
    title: "S",
    summary: "",
    flashcards: [],
    discussionQuestions: [],
    characterNotes: [],
    contextDigest: "",
    error: null,
    modelUsed: "",
    ...p,
  };
}

function csvLines(content: string): string[] {
  return content.split("\r\n").filter((l) => l.length > 0);
}

describe("flashcard model (§3)", () => {
  it("3.1 default card type is basic", () => {
    const c = card({});
    expect(c.cardType).toBe("basic");
    expect(isCloze(c)).toBe(false);
  });
  it("3.2 cloze flag", () => {
    const c = card({ front: "M are the {{c1::powerhouse}}.", back: "", cardType: "cloze" });
    expect(isCloze(c)).toBe(true);
  });
});

describe("CSV export (§4)", () => {
  const fixture = [
    res({
      title: "Chapter 1",
      flashcards: [
        card({ front: "How deep is the Dead Sea?", back: "304 meters" }),
        card({ front: "The sea is {{c1::430}} m below.", back: "", cardType: "cloze" }),
      ],
    }),
  ];

  it("4.1 basic CSV excludes cloze cards", () => {
    const { content, count } = exportFlashcardsCsv(fixture, "Book");
    const lines = csvLines(content);
    expect(count).toBe(1);
    expect(lines.length).toBe(1);
    expect(content).not.toContain("{{c");
    expect(content).toContain("How deep is the Dead Sea?");
  });

  it("4.2 cloze CSV excludes basic cards", () => {
    const { content, count } = exportClozeFlashcardsCsv(fixture, "Book");
    expect(count).toBe(1);
    expect(csvLines(content).length).toBe(1);
    expect(content).toContain("{{c1::430}}");
  });

  it("4.3 tags format (spaces → underscores)", () => {
    const r = [res({ title: "Chapter 1: The Storm", flashcards: [card({})] })];
    const { content } = exportFlashcardsCsv(r, "My Book");
    expect(content).toContain("My_Book::Chapter_1:_The_Storm");
  });

  it("4.4 section with zero flashcards yields no rows", () => {
    const r = [res({ title: "TOC", flashcards: [] })];
    expect(exportFlashcardsCsv(r).count).toBe(0);
    expect(exportClozeFlashcardsCsv(r).count).toBe(0);
  });

  it("4.5 multi-deletion cloze preserved", () => {
    const r = [
      res({
        flashcards: [
          card({ front: "Founded in {{c1::1949}} by {{c2::twelve}} nations.", back: "", cardType: "cloze" }),
        ],
      }),
    ];
    const { content } = exportClozeFlashcardsCsv(r);
    expect(content).toContain("Founded in {{c1::1949}} by {{c2::twelve}} nations.");
  });

  it("countClozeFlashcards", () => {
    expect(countClozeFlashcards(fixture)).toBe(1);
  });
});

describe("Markdown export (§5)", () => {
  it("5.1 basic card rendering", () => {
    const md = exportSummariesMarkdown([
      res({ flashcards: [card({ front: "How deep is the Dead Sea?", back: "304 meters" })] }),
    ]);
    expect(md).toContain("- **Q:** How deep is the Dead Sea?");
    expect(md).toContain("  **A:** 304 meters");
  });

  it("5.2 cloze card rendering preserves markup", () => {
    const md = exportSummariesMarkdown([
      res({
        flashcards: [
          card({
            front: "The Dead Sea sits {{c1::430}} m below sea level.",
            back: "Lowest land elevation on Earth.",
            cardType: "cloze",
          }),
        ],
      }),
    ]);
    expect(md).toContain("Cloze cards");
    expect(md).toContain("{{c1::430}}");
    expect(md).toContain("*Lowest land elevation on Earth.*");
  });

  it("5.3 cloze with empty back has no stray italic line", () => {
    const md = exportSummariesMarkdown([
      res({ flashcards: [card({ front: "...{{c1::1949}}...", back: "", cardType: "cloze" })] }),
    ]);
    expect(md).not.toMatch(/\n\s*\*\*\s*\n/);
    // No empty italic emphasis (just "**" or "*  *") after the cloze sentence.
    expect(md).toContain("- ...{{c1::1949}}...");
  });

  it("5.4 section with no cards omits Flashcards header", () => {
    const md = exportSummariesMarkdown([res({ title: "Table of Contents", flashcards: [] })]);
    expect(md).toContain("## Table of Contents");
    expect(md).not.toContain("**Flashcards:**");
    expect(md).not.toContain("Cloze cards");
  });

  it("5.5 single-model attribution", () => {
    const md = exportSummariesMarkdown(
      [
        res({ title: "A", summary: "x", modelUsed: "claude-sonnet-4-6 (Anthropic API)" }),
        res({ title: "B", summary: "y", modelUsed: "claude-sonnet-4-6 (Anthropic API)" }),
      ],
      "Book"
    );
    expect(md).toContain("_Generated with: claude-sonnet-4-6 (Anthropic API)_");
    expect(md).not.toContain("_Model:");
  });

  it("5.6 mixed-model attribution", () => {
    const md = exportSummariesMarkdown([
      res({ title: "A", summary: "x", modelUsed: "claude-sonnet-4-6 (Anthropic API)" }),
      res({ title: "B", summary: "y", modelUsed: "llama3.1:8b (Ollama)" }),
    ]);
    expect(md).toContain("_Generated with multiple models:");
    expect(md).toContain("_Model: claude-sonnet-4-6 (Anthropic API)_");
    expect(md).toContain("_Model: llama3.1:8b (Ollama)_");
  });
});

describe("Word export (§6)", () => {
  it("6.1 returns a valid .docx (zip) buffer", async () => {
    const buf = await exportSummariesDocx(
      [
        res({
          title: "Chapter 1",
          summary: "A summary.",
          flashcards: [card({ front: "Q?", back: "A." })],
          modelUsed: "claude-sonnet-4-6 (Anthropic API)",
        }),
      ],
      "Book",
      [{ name: "Elizabeth", summary: "Protagonist." }]
    );
    expect(buf.length).toBeGreaterThan(0);
    // .docx is a zip archive — starts with the PK signature.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
