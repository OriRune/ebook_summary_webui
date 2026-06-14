import { describe, it, expect } from "vitest";
import { splitPlainText, detectTitleAuthorFromText } from "@/lib/parser/plaintext";

function makeParagraphs(totalChars: number, paraChars = 500): string {
  const para = "word ".repeat(Math.ceil(paraChars / 5)).trim();
  const count = Math.ceil(totalChars / para.length);
  return Array.from({ length: count }, () => para).join("\n\n");
}

describe("parser — section detection", () => {
  it("1.1 heading regex detection (plain text)", () => {
    const input = `Chapter 1: The Storm

It was a dark and stormy night. The wind howled through the trees.
The rain lashed against the windows without mercy.

Chapter 2: The Morning After

The sun rose hesitantly over the hills. Birds resumed their routines
as if nothing had happened.`;
    const sections = splitPlainText(input);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Chapter 1: The Storm");
    expect(sections[0].text).toContain("dark and stormy night");
    expect(sections[1].title).toBe("Chapter 2: The Morning After");
    expect(sections[1].text).toContain("sun rose hesitantly");
  });

  it("1.2 markdown heading detection (# stripped)", () => {
    const input = `## Introduction

This book explores the nature of memory and identity.
Research suggests that...

## Chapter One: First Principles

The earliest experiments date from 1879...`;
    const sections = splitPlainText(input);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Introduction");
    expect(sections[1].title).toBe("Chapter One: First Principles");
  });

  it("1.3 roman numeral headings", () => {
    const input = `I

It was the best of times, it was the worst of times.

II

It was the age of wisdom, it was the age of foolishness.`;
    const sections = splitPlainText(input);
    expect(sections.map((s) => s.title)).toEqual(["I", "II"]);
  });

  it("1.3 counter-case: LIVID/MILD/CIVIL are not roman numerals", () => {
    const input = `LIVID

Some ordinary prose here that goes on.

MILD

More ordinary prose that continues.`;
    const sections = splitPlainText(input);
    // No headings detected → single paragraph-chunk fallback section.
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe("Part 1");
  });

  it("1.4 paragraph-chunk fallback", () => {
    const input = makeParagraphs(25000, 500);
    const sections = splitPlainText(input, 9000);
    expect(sections.length).toBe(3);
    expect(sections.map((s) => s.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    for (const s of sections) expect(s.text.length).toBeLessThanOrEqual(9000);
  });

  it("1.4b balanced chunks avoid a tiny trailing section", () => {
    // 9.5k chars with a 9k cap would greedily give one 9k chunk + a ~0.5k
    // sliver; balanced splitting should produce two near-equal chunks instead.
    const input = makeParagraphs(9500, 500);
    const sections = splitPlainText(input, 9000);
    expect(sections.length).toBe(2);
    const sizes = sections.map((s) => s.text.length);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(9000);
    const [a, b] = sizes;
    const largest = Math.max(a, b);
    const smallest = Math.min(a, b);
    // Neither chunk should be a lopsided sliver — keep them within ~40%.
    expect(smallest).toBeGreaterThan(largest * 0.6);
  });

  it("1.5 oversized section subdivision", () => {
    const big = makeParagraphs(25000, 500);
    const small = makeParagraphs(3000, 500);
    const input = `Chapter 1\n\n${big}\n\nChapter 2\n\n${small}`;
    const sections = splitPlainText(input, 9000);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Chapter 1 (part 1 of 3)");
    expect(titles).toContain("Chapter 1 (part 2 of 3)");
    expect(titles).toContain("Chapter 1 (part 3 of 3)");
    expect(titles).toContain("Chapter 2");
    for (const s of sections) {
      if (s.title.startsWith("Chapter 1 (part")) {
        expect(s.text.length).toBeLessThanOrEqual(9000);
      }
    }
  });

  it("1.6 Project Gutenberg boilerplate stripping", () => {
    const input = `*** START OF THE PROJECT GUTENBERG EBOOK TEST ***

Chapter 1

The real content begins here and is meaningful.

Chapter 2

The second chapter of real content.

*** END OF THE PROJECT GUTENBERG EBOOK TEST ***
Some trailing license text that should be gone.`;
    const sections = splitPlainText(input);
    const all = sections.map((s) => s.text).join("\n");
    expect(all).not.toContain("PROJECT GUTENBERG");
    expect(all).not.toContain("trailing license");
    expect(all).toContain("real content begins");
  });
});

describe("parser — title/author detection", () => {
  it("1.10 plain text Title:/Author: lines", () => {
    const text = `Title: Wuthering Heights\nAuthor: Emily Brontë\n\nChapter 1`;
    expect(detectTitleAuthorFromText(text)).toEqual([
      "Wuthering Heights",
      "Emily Brontë",
    ]);
  });

  it("1.11 markdown heading + by line", () => {
    const text = `# The Great Experiment\n\nby Dr. Sarah Collins\n\nSome opening text.`;
    expect(detectTitleAuthorFromText(text)).toEqual([
      "The Great Experiment",
      "Dr. Sarah Collins",
    ]);
  });
});
