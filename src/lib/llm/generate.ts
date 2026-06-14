/**
 * Per-section generation, ported from llm_client.py generate_section_content.
 * Calls the selected backend once for a single section and parses the JSON into
 * a SectionResult. On any failure, `error` is set and the rest is empty.
 */
import type {
  Backend,
  CardType,
  CharacterNote,
  ContentType,
  Flashcard,
  SectionResult,
} from "@/types";
import { BACKEND_LABELS } from "@/types";
import { buildSystemPrompt, buildUserMessage } from "./buildPrompt";
import { extractJson } from "./extractJson";
import { callModel } from "./backends";
import { DEFAULT_MODEL } from "./prompts";

function asString(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function emptyResult(title: string, error: string): SectionResult {
  return {
    title,
    summary: "",
    flashcards: [],
    discussionQuestions: [],
    characterNotes: [],
    contextDigest: "",
    error,
    modelUsed: "",
  };
}

export interface GenerateSectionOptions {
  apiKey: string;
  sectionTitle: string;
  sectionText: string;
  includeSummary?: boolean;
  includeFlashcards?: boolean;
  includeDiscussion?: boolean;
  includeCharacterNotes?: boolean;
  includeContextDigest?: boolean;
  priorContext?: string | null;
  priorChapterFlashcardFronts?: string[] | null;
  priorChapterDiscussionQuestions?: string[] | null;
  contentType?: ContentType;
  model?: string;
  backend?: Backend;
}

export async function generateSectionContent({
  apiKey,
  sectionTitle,
  sectionText,
  includeSummary = true,
  includeFlashcards = true,
  includeDiscussion = false,
  includeCharacterNotes = false,
  includeContextDigest = false,
  priorContext = null,
  priorChapterFlashcardFronts = null,
  priorChapterDiscussionQuestions = null,
  contentType = "auto",
  model = DEFAULT_MODEL,
  backend = "anthropic",
}: GenerateSectionOptions): Promise<SectionResult> {
  if (!(includeSummary || includeFlashcards || includeDiscussion)) {
    return emptyResult(
      sectionTitle,
      "Nothing was selected to generate (enable summary, flashcards, and/or discussion questions)."
    );
  }

  // Only worth the prompt overhead when there's actually something to steer
  // around (e.g. not the first part of a chapter).
  const chapterFronts =
    priorChapterFlashcardFronts && priorChapterFlashcardFronts.length > 0
      ? priorChapterFlashcardFronts
      : null;
  const chapterQuestions =
    priorChapterDiscussionQuestions && priorChapterDiscussionQuestions.length > 0
      ? priorChapterDiscussionQuestions
      : null;
  const includeChapterContinuity = Boolean(chapterFronts || chapterQuestions);

  const systemPrompt = buildSystemPrompt({
    includeSummary,
    includeFlashcards,
    includeDiscussion,
    contentType,
    includeCharacterNotes,
    includeContextDigest,
    includeChapterContinuity,
  });
  const userMessage = buildUserMessage({
    sectionTitle,
    sectionText,
    priorContext: includeContextDigest ? priorContext : null,
    priorChapterFlashcardFronts: chapterFronts,
    priorChapterDiscussionQuestions: chapterQuestions,
  });

  try {
    const rawText = await callModel({
      backend,
      apiKey,
      model,
      systemPrompt,
      userMessage,
      maxTokens: 4096,
    });
    const parsed = extractJson(rawText);

    const summary = includeSummary ? asString(parsed.summary).trim() : "";

    const cards: Flashcard[] = [];
    if (includeFlashcards) {
      const raw = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
      for (const item of raw as Array<Record<string, unknown>>) {
        const front = asString(item.front).trim();
        const back = asString(item.back).trim();
        if (!front) continue;
        let cardType = asString(item.type, "basic").trim().toLowerCase();
        if (cardType !== "basic" && cardType !== "cloze") cardType = "basic";
        // Cloze cards carry their answer inline; an empty back is fine. Basic
        // Q&A cards need both halves to be useful.
        if (cardType === "basic" && !back) continue;
        cards.push({ front, back, cardType: cardType as CardType });
      }
    }

    let questions: string[] = [];
    if (includeDiscussion) {
      const raw = Array.isArray(parsed.discussion_questions)
        ? parsed.discussion_questions
        : [];
      questions = raw.map((q) => asString(q).trim()).filter((q) => q.length > 0);
    }

    const notes: CharacterNote[] = [];
    if (includeCharacterNotes) {
      const raw = Array.isArray(parsed.character_notes) ? parsed.character_notes : [];
      for (const item of raw as Array<Record<string, unknown>>) {
        if (item.name && item.note) {
          notes.push({
            name: asString(item.name).trim(),
            note: asString(item.note).trim(),
          });
        }
      }
    }

    const digest = includeContextDigest ? asString(parsed.context_digest).trim() : "";

    const modelLabel = `${model} (${BACKEND_LABELS[backend]})`;
    return {
      title: sectionTitle,
      summary,
      flashcards: cards,
      discussionQuestions: questions,
      characterNotes: notes,
      contextDigest: digest,
      error: null,
      modelUsed: modelLabel,
    };
  } catch (e) {
    return emptyResult(sectionTitle, e instanceof Error ? e.message : String(e));
  }
}
