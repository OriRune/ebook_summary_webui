import { describe, it, expect } from "vitest";
import type { CharacterNote, Section, SectionResult } from "@/types";
import {
  toProcessIndices,
  reconstructInitialNotes,
  reconstructInitialContext,
} from "@/lib/resume";

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

const sections: Section[] = [
  { title: "Sec 0", text: "" },
  { title: "Sec 1", text: "" },
  { title: "Sec 2", text: "" },
];

describe("resume logic (§9)", () => {
  it("9.1 skips sections with existing successful results", () => {
    const results = { 0: res({ summary: "done" }) };
    expect(toProcessIndices([0, 1, 2], results)).toEqual([1, 2]);
  });

  it("9.2 all done → empty to_process", () => {
    const results = { 0: res({}), 1: res({}), 2: res({}) };
    expect(toProcessIndices([0, 1, 2], results)).toEqual([]);
  });

  it("9.2b errored section is reprocessed", () => {
    const results = { 0: res({}), 1: res({ error: "boom" }) };
    expect(toProcessIndices([0, 1], results)).toEqual([1]);
  });

  it("9.3 reconstruct initial context = last successful digest in index order", () => {
    const results = {
      0: res({ contextDigest: "recap-0" }),
      1: res({ contextDigest: "recap-1" }),
      2: res({ error: "failed" }),
    };
    expect(reconstructInitialContext(results)).toBe("recap-1");
  });

  it("9.4 reconstruct initial notes from prior successful results, in order", () => {
    const n0: CharacterNote[] = [{ name: "A", note: "n0" }];
    const n1: CharacterNote[] = [{ name: "B", note: "n1" }];
    const results = {
      0: res({ characterNotes: n0 }),
      1: res({ characterNotes: n1 }),
      2: res({ error: "failed" }),
    };
    expect(reconstructInitialNotes(sections, results)).toEqual([
      ["Sec 0", n0],
      ["Sec 1", n1],
    ]);
  });
});
