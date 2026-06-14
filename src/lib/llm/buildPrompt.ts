/**
 * Prompt assembly, ported from llm_client.py _build_system_prompt /
 * _build_user_message. Blocks are joined with "\n\n"; the user-message blocks
 * are joined with "\n\n---\n\n". Only requested fields appear in the JSON shape
 * line. The exact strings here must match the desktop output.
 */
import type { ContentType } from "@/types";
import {
  GENRE_INTROS,
  SUMMARY_INSTRUCTION,
  FLASHCARD_INSTRUCTIONS,
  DISCUSSION_INSTRUCTIONS,
  CHARACTER_NOTES_INSTRUCTION,
  ROLLING_DIGEST_INSTRUCTION,
  CHAPTER_CONTINUITY_INSTRUCTION,
} from "./prompts";

export interface SystemPromptParts {
  includeSummary: boolean;
  includeFlashcards: boolean;
  includeDiscussion: boolean;
  contentType?: ContentType;
  includeCharacterNotes?: boolean;
  includeContextDigest?: boolean;
  includeChapterContinuity?: boolean;
}

export function buildSystemPrompt({
  includeSummary,
  includeFlashcards,
  includeDiscussion,
  contentType = "auto",
  includeCharacterNotes = false,
  includeContextDigest = false,
  includeChapterContinuity = false,
}: SystemPromptParts): string {
  const genreIntro = GENRE_INTROS[contentType] ?? GENRE_INTROS.auto;
  const parts: string[] = [
    "You are a study-aid assistant. You will be given one section/chapter " +
      "of a book. " +
      genreIntro,
  ];
  const fields: string[] = [];

  if (includeSummary) {
    parts.push(SUMMARY_INSTRUCTION);
    fields.push('"summary": "..."');
  }
  if (includeFlashcards) {
    parts.push(FLASHCARD_INSTRUCTIONS);
    fields.push(
      '"flashcards": [{"type": "basic or cloze", "front": "question, ' +
        'prompt, or cloze sentence", "back": "answer, or extra context ' +
        'for a cloze card (may be empty)"}, ...] (an empty array is ' +
        "correct when nothing in this section is worth memorizing)"
    );
  }
  if (includeDiscussion) {
    parts.push(DISCUSSION_INSTRUCTIONS);
    fields.push('"discussion_questions": ["...", ...]');
  }
  if (includeCharacterNotes) {
    parts.push(CHARACTER_NOTES_INSTRUCTION);
    fields.push('"character_notes": [{"name": "...", "note": "..."}, ...]');
  }
  if (includeContextDigest) {
    parts.push(ROLLING_DIGEST_INSTRUCTION);
    fields.push('"context_digest": "..."');
  }
  if (includeChapterContinuity) {
    parts.push(CHAPTER_CONTINUITY_INSTRUCTION);
  }

  parts.push(
    "Respond with ONLY a JSON object, no other text, in exactly this shape:\n" +
      "{" +
      fields.join(", ") +
      "}"
  );
  return parts.join("\n\n");
}

export interface UserMessageParts {
  sectionTitle: string;
  sectionText: string;
  priorContext?: string | null;
  priorChapterFlashcardFronts?: string[] | null;
  priorChapterDiscussionQuestions?: string[] | null;
}

export function buildUserMessage({
  sectionTitle,
  sectionText,
  priorContext = null,
  priorChapterFlashcardFronts = null,
  priorChapterDiscussionQuestions = null,
}: UserMessageParts): string {
  const parts: string[] = [];

  if (priorContext) {
    parts.push(
      "Recap of the story so far, for background only (don't repeat, " +
        "summarize, or grade this back to me — just use it to understand " +
        "context the section below may assume):\n\n" +
        priorContext.trim()
    );
  }

  if (
    (priorChapterFlashcardFronts && priorChapterFlashcardFronts.length > 0) ||
    (priorChapterDiscussionQuestions && priorChapterDiscussionQuestions.length > 0)
  ) {
    const chapterLines: string[] = [
      "Already produced for EARLIER PARTS of this same chapter — treat " +
        "as covered, and don't write new cards or questions that retest " +
        "or rephrase any of these:",
    ];
    if (priorChapterFlashcardFronts && priorChapterFlashcardFronts.length > 0) {
      chapterLines.push("\nFlashcard concepts already tested:");
      for (const front of priorChapterFlashcardFronts) {
        chapterLines.push(`- ${front}`);
      }
    }
    if (
      priorChapterDiscussionQuestions &&
      priorChapterDiscussionQuestions.length > 0
    ) {
      chapterLines.push("\nDiscussion questions already asked:");
      for (const q of priorChapterDiscussionQuestions) {
        chapterLines.push(`- ${q}`);
      }
    }
    parts.push(chapterLines.join("\n"));
  }

  parts.push(`Section title: ${sectionTitle}\n\nSection text:\n${sectionText}`);
  return parts.join("\n\n---\n\n");
}
