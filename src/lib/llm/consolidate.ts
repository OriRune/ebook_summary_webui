/**
 * Character-list consolidation, ported from llm_client.py
 * consolidate_character_list. One additional backend call that merges the
 * per-section character notes gathered during a run into a full-book guide.
 */
import type { Backend, CharacterNote, CharacterSummary } from "@/types";
import { CHARACTER_LIST_SYSTEM_PROMPT, DEFAULT_MODEL } from "./prompts";
import { extractJson } from "./extractJson";
import { callModel } from "./backends";

export interface ConsolidateResult {
  characters: CharacterSummary[];
  error: string | null;
}

function asString(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

export async function consolidateCharacterList(
  apiKey: string,
  bookTitle: string,
  notesBySection: Array<[string, CharacterNote[]]>,
  model: string = DEFAULT_MODEL,
  backend: Backend = "anthropic"
): Promise<ConsolidateResult> {
  const lines: string[] = [];
  for (const [title, notes] of notesBySection) {
    if (!notes.length) continue;
    lines.push(`Section: ${title}`);
    for (const n of notes) {
      lines.push(`- ${n.name}: ${n.note}`);
    }
    lines.push("");
  }
  const digest = lines.join("\n").trim();
  if (!digest) {
    return {
      characters: [],
      error: "No character notes were gathered from the generated sections.",
    };
  }

  const systemPrompt = CHARACTER_LIST_SYSTEM_PROMPT.replace(
    "{book_title}",
    bookTitle || "this book"
  );
  const userContent = `Section-by-section character notes:\n\n${digest}`;

  try {
    const rawText = await callModel({
      backend,
      apiKey,
      model,
      systemPrompt,
      userMessage: userContent,
      maxTokens: 4096,
    });
    const parsed = extractJson(rawText);
    const raw = Array.isArray(parsed.characters) ? parsed.characters : [];
    const characters: CharacterSummary[] = [];
    for (const item of raw as Array<Record<string, unknown>>) {
      if (item.name && item.summary) {
        characters.push({
          name: asString(item.name).trim(),
          summary: asString(item.summary).trim(),
        });
      }
    }
    return { characters, error: null };
  } catch (e) {
    return { characters: [], error: e instanceof Error ? e.message : String(e) };
  }
}
