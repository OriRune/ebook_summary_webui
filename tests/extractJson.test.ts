import { describe, it, expect } from "vitest";
import { extractJson, JsonExtractionError } from "@/lib/llm/extractJson";

describe("extractJson — JSON extraction from model responses", () => {
  it("2.1 clean JSON", () => {
    expect(extractJson('{"summary": "Short summary.", "flashcards": []}')).toEqual({
      summary: "Short summary.",
      flashcards: [],
    });
  });

  it("2.2 JSON in markdown code fence", () => {
    const input =
      'Sure! Here\'s the JSON:\n\n```json\n{"flashcards": [{"type": "basic", "front": "Q", "back": "A"}]}\n```';
    expect(extractJson(input)).toEqual({
      flashcards: [{ type: "basic", front: "Q", back: "A" }],
    });
  });

  it("2.3 JSON preceded by prose", () => {
    expect(extractJson('Here you go:\n{"summary": "x"}\nHope that helps!')).toEqual({
      summary: "x",
    });
  });

  it("2.4 <think> block stripping", () => {
    expect(
      extractJson('<think>Let me think about this...</think>\n{"summary": "result"}')
    ).toEqual({ summary: "result" });
  });

  it("2.5 balanced-brace extraction (stray trailing brace)", () => {
    expect(extractJson('{"summary": "ok"}}')).toEqual({ summary: "ok" });
  });

  it("2.6 no valid JSON throws", () => {
    expect(() => extractJson("Sorry, I can't help with that.")).toThrow(
      JsonExtractionError
    );
  });
});
