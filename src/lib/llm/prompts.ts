/**
 * LLM prompt constants — ported VERBATIM from the desktop app's llm_client.py
 * (see handoff/prompts.md). These strings are the exact text sent to the model
 * and must remain byte-identical to preserve output behavior. Do not reword.
 */
import type { ContentType } from "@/types";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export const GENRE_INTROS: Record<ContentType, string> = {
  fiction:
    "You're told in advance that this book is FICTION (a novel, story, " +
    "play, etc.). Tailor everything you produce to fiction conventions: " +
    "plot developments, characters and their motivations, settings, and " +
    "themes.",
  nonfiction:
    "You're told in advance that this book is NONFICTION (e.g. an essay, " +
    "textbook, history, biography, or memoir). Tailor everything you " +
    "produce to nonfiction conventions: key concepts, definitions, " +
    "claims/arguments, evidence, and takeaways.",
  auto:
    "Determine for yourself whether this section reads as fiction or " +
    "nonfiction, and tailor everything you produce accordingly — for " +
    "fiction, focus on plot/characters/themes; for nonfiction, focus on " +
    "concepts/arguments/evidence.",
};

export const SUMMARY_INSTRUCTION =
  "Produce a concise summary capturing the key events, ideas, or arguments " +
  "in the section.";

export const FLASHCARD_INSTRUCTIONS =
  "Produce flashcards for studying and remembering the material, in " +
  "keeping with the genre guidance above, following these principles " +
  "(drawn from spaced-repetition research on what actually makes cards " +
  "memorable):\n" +
  "- MINIMUM INFORMATION PRINCIPLE: each card should test exactly one " +
  "atomic fact, and the answer should be as short as it can possibly be — " +
  "ideally a single word, name, number, or short phrase, not a sentence. " +
  'If a passage bundles several facts together (e.g. "the Dead Sea is ' +
  '304m deep, the lowest body of water on Earth, and so salty that ' +
  'swimmers float effortlessly"), write SEPARATE cards for each fact ' +
  "(its depth; its ranking; its salinity/buoyancy effect) rather than one " +
  "card whose answer tries to hold all of it. Prefer several small, sharp " +
  "cards over one dense one — this is the single most important thing " +
  "that makes a card easy to remember.\n" +
  "- LET THE MATERIAL SET THE COUNT: there is no fixed number to hit. A " +
  "passage dense with discrete facts may genuinely warrant fifteen or " +
  "more atomic cards; a thin passage may warrant only a couple. For " +
  "sections with nothing worth memorizing — a table of contents, an " +
  "index, an acknowledgements or copyright page, pure scene-setting with " +
  "no durable facts — producing zero flashcards is the CORRECT outcome. " +
  "Never pad with trivial, vague, or redundant cards just to reach a " +
  "quota; an empty flashcards list is far better than a weak one.\n" +
  '- AVOID SETS AND ENUMERATIONS: don\'t write cards like "What are the ' +
  'five causes of the war?" or "Name the founding members of the ' +
  'alliance" — unordered groups like this are notoriously hard to recall ' +
  "as a block and easy to half-remember. Instead, either ask about each " +
  'item on its own ("What was one major cause of the war: the ' +
  '[specific cause]?"), or, when the sequence or full membership ' +
  "genuinely matters, render it as a cloze card (see below) rather than " +
  "a single recall-the-whole-list question.\n" +
  "- REDUCE INTERFERENCE: phrase questions so they can't be confused with " +
  "each other or answered correctly by guessing a similar-sounding fact " +
  "from elsewhere in the section — when two facts are easily mixed up " +
  "(similar names, dates, numbers), make each card's wording pin down " +
  "exactly which one it's asking about.\n" +
  "- CLOZE DELETION: when a fact reads most naturally as a sentence with " +
  "one key term blanked out (a name, date, number, or technical term), " +
  "you may produce a cloze card instead of a question/answer card. Write " +
  "out the full sentence with the key term wrapped in Anki's cloze " +
  'syntax, e.g. "Mitochondria are the {{c1::powerhouse}} of the cell." ' +
  "Use {{c2::}}, {{c3::}}, etc. for additional deletions in the SAME card " +
  "only when those facts are genuinely linked and worth testing together " +
  "— otherwise make them separate cards. For a cloze card, set " +
  '"type": "cloze", put the cloze sentence in "front", and either ' +
  'leave "back" empty or use it for a short bit of extra context to ' +
  "show alongside the answer. For an ordinary question/answer card, set " +
  '"type": "basic" and keep the back concise (ideally one short ' +
  "phrase or sentence, never a paragraph).";

export const DISCUSSION_INSTRUCTIONS =
  "Produce a small set of open-ended discussion questions suitable for a " +
  "reading group or classroom — questions that invite analysis, " +
  "interpretation, or debate rather than simple recall (distinct in spirit " +
  "from flashcard recall questions, if both are being produced). Write only " +
  "2-3 questions for this section: resist the urge to cover everything that " +
  "happened, and instead pick just the 2-3 moments, choices, or ideas most " +
  "worth a group's time — the ones with real interpretive depth or room for " +
  "disagreement. Each question should be sharply focused on one specific " +
  "thing (a character's choice, a passage's implication, a tension the " +
  'section raises) rather than broad or multi-part (avoid "…and how does ' +
  'this relate to X, Y, and Z?" stacking). A few excellent questions beat ' +
  "many average ones — quality and focus matter far more than quantity here, " +
  "in keeping with the genre guidance above.";

export const CHARACTER_NOTES_INSTRUCTION =
  "Additionally, note any named people who have a meaningful presence in " +
  "*this section specifically* — skip anyone only mentioned in passing. " +
  "In fiction this means characters; in nonfiction (history, biography, " +
  "memoir, journalism, etc.) it means the real people the material centers " +
  "on — historical figures, subjects, sources, whoever the narrative " +
  "actually follows. For each, write a brief 1-2 sentence note on what " +
  "they do, reveal, decide, or how they change here (in nonfiction terms: " +
  "what role they play in the events or argument of this section). Keep " +
  "this list focused: roughly 6 people at most for this section, " +
  "prioritizing whoever matters most to what happens in it. These notes " +
  "will later be merged across all sections into a single full-book guide, " +
  "so favor what's new or notable in this section over general description " +
  "of who the person is.";

export const ROLLING_DIGEST_INSTRUCTION =
  "Additionally, maintain a brief running digest of the story so far, to be " +
  "handed forward as background for whoever processes the next section " +
  "(it won't be shown to the reader, so don't treat it as a deliverable in " +
  "its own right). If a recap of earlier sections was provided to you above, " +
  "treat it as your starting point and fold in what happens in *this* " +
  "section — updating, replacing, or dropping earlier details as needed so " +
  "the digest reflects the story's current state rather than just piling on. " +
  "If no recap was provided, start one from this section. Keep it compact " +
  "regardless of how far into the book this is — roughly 4-6 sentences " +
  "covering whichever events, characters, and open threads matter most for " +
  "understanding what comes next.";

export const CHAPTER_CONTINUITY_INSTRUCTION =
  "This section is one piece of a larger chapter that had to be split for " +
  "processing — you may be looking at the middle or tail end of a longer " +
  "whole. If a list of flashcard concepts and/or discussion questions " +
  "already produced for EARLIER PARTS OF THIS SAME CHAPTER appears below, " +
  "treat those as already covered and off-limits for repetition: don't " +
  "write new cards or questions that retest the same fact, revisit the " +
  "same scene, or re-ask the same question in different words. Focus on " +
  "what's distinct, new, or different in the material actually in front of " +
  "you — there's no need to re-establish things the earlier parts already " +
  "handled.";

/**
 * Character consolidation system prompt. Uses {book_title} as a placeholder
 * (filled at call time) — ported from _CHARACTER_LIST_SYSTEM_PROMPT.
 */
export const CHARACTER_LIST_SYSTEM_PROMPT =
  'You are building a guide to the key people in "{book_title}". In a ' +
  "novel or other fiction that means its main characters; in nonfiction " +
  "(history, biography, memoir, journalism, etc.) it means the real people " +
  "the material centers on — historical figures, subjects, sources, " +
  "whoever the narrative actually follows. You'll be given short notes " +
  "about them gathered section-by-section across the whole book — the same " +
  "person may appear many times, sometimes referred to by different names, " +
  "nicknames, or titles.\n\n" +
  "Your job:\n" +
  "1. Merge notes that refer to the same person.\n" +
  "2. Identify the MAIN figures only — the ones genuinely central to the " +
  "story or material. If many named people appear, judiciously narrow the " +
  "list to roughly the 8-15 most important; it's fine, and often better, " +
  "to leave minor or incidental figures out entirely rather than pad the " +
  "list.\n" +
  "3. For each, write one well-rounded paragraph (roughly 3-6 sentences) " +
  "describing their role across the book as a whole — who they are, key " +
  "relationships, and their arc or significance — synthesizing the notes " +
  "rather than just concatenating them.\n\n" +
  "Respond with ONLY a JSON object, no other text, in exactly this shape:\n" +
  '{"characters": [{"name": "...", "summary": "..."}, ...]}\n' +
  "List them roughly in order of importance, most central first.";
