"""
Claude API client: turns one ebook section into an optional summary, and
optionally study flashcards and/or discussion questions.

Works for both fiction (plot/character/theme-oriented material) and nonfiction
(concept/definition/argument-oriented material). By default Claude infers
which one it's looking at; the caller can also state it explicitly via
`content_type` to skip that inference step.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field

# Shared "(part N of M)" title-suffix pattern — see parser.py for the full
# rationale. Used here by ChapterContinuityTracker to recognize when
# consecutive sections belong to the same split chapter.
from parser import PART_RE

DEFAULT_MODEL = "claude-sonnet-4-6"

# URL for the local Ollama instance. The /v1 path exposes an
# OpenAI-compatible API; /api/tags is Ollama's native model-list endpoint.
OLLAMA_BASE_URL = "http://localhost:11434"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# --- Rough cost estimation (no API calls — pure arithmetic over data we ---
# --- already have, used to power a live "estimated cost" readout in the UI) -
#
# Pricing below is current Claude Sonnet 4.6 list pricing as of mid-2026 (see
# https://platform.claude.com/docs/en/about-claude/pricing for up-to-date
# rates — Anthropic can and does change these).
PRICE_PER_INPUT_TOKEN = 3.00 / 1_000_000    # $3.00 / million input tokens
PRICE_PER_OUTPUT_TOKEN = 15.00 / 1_000_000  # $15.00 / million output tokens

# English text runs roughly 3-4 characters per token; 3.5 is a reasonable
# middle estimate for the kind of prose this app processes.
_CHARS_PER_TOKEN = 3.5

# Hard output ceilings used by the actual API calls below — the estimate uses
# these as the per-call cap so it can't wildly undershoot.
_SECTION_MAX_OUTPUT_TOKENS = 4096
_CONSOLIDATION_MAX_OUTPUT_TOKENS = 4096

# Rough fixed overhead (in tokens) added to every section call by the prompt
# scaffolding — instructions, genre guidance, requested-content framing — on
# top of the section text itself.
_PROMPT_OVERHEAD_TOKENS = 400

# Rough per-feature contributions to a section call's output, used to build up
# a more informative (and reactive) estimate than just always assuming the
# 2048-token ceiling regardless of what's checked. The per-section total is
# still capped at _SECTION_MAX_OUTPUT_TOKENS.
_OUTPUT_TOKENS_PER_FEATURE = {
    "summary": 220,          # a concise paragraph or two
    "flashcards": 340,       # count now varies with density (atomic cards can
                             # run higher than the old fixed 5-10) — ballpark
                             # ~9 short cards x ~35-40 tokens each
    "discussion": 90,        # ~2-3 sharply-focused questions x ~30-35 tokens each
    "character_notes": 240,  # up to ~6 short per-section character notes
    "context_digest": 110,   # ~4-6 sentence rolling "story so far" recap
}

# Rough size of the compact per-section character-note digest fed into the one
# extra consolidation call (per section), plus its own instruction overhead.
_CONSOLIDATION_INPUT_PER_SECTION_TOKENS = 120
_CONSOLIDATION_INPUT_OVERHEAD_TOKENS = 300

# Rough size of the rolling recap text fed forward as input context to every
# section after the first, when "carry story context forward" is enabled.
_CONTEXT_DIGEST_INPUT_TOKENS = 110

# Rough size of the "already covered in earlier parts of this chapter" block
# fed forward when "Avoid repeating flashcards/questions across chapter parts"
# is on. Like the context digest, this only ever lands on later parts of a
# split chapter — but since the estimator works from char counts alone (it
# can't know in advance which sections the parser will mark as chapter parts),
# it applies the same "every section after the first" approximation as the
# context digest. That mildly overstates the true cost (most books aren't
# wall-to-wall split chapters), which is consistent with this being a ballpark,
# not a bill.
_CHAPTER_CONTINUITY_INPUT_TOKENS = 90


@dataclass
class CostEstimate:
    """A rough, approximate token/USD estimate for a prospective run."""
    input_tokens: int
    output_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def usd(self) -> float:
        return (self.input_tokens * PRICE_PER_INPUT_TOKEN
                + self.output_tokens * PRICE_PER_OUTPUT_TOKEN)


def estimate_run_cost(
    section_char_counts: list[int],
    *,
    want_summary: bool,
    want_flashcards: bool,
    want_discussion: bool,
    want_character_list: bool,
    want_context_digest: bool = False,
    want_chapter_continuity: bool = False,
) -> CostEstimate:
    """Rough estimate of the token usage (and USD cost) a "Generate" run with
    this configuration would use.

    This is intentionally simple, approximate arithmetic over data the caller
    already has on hand (character counts of the checked sections, and which
    content types are requested) — it makes no API calls and isn't meant to be
    exact, just a useful ballpark that updates live as the user adjusts what
    they're about to generate. Actual usage will vary with how dense/talkative
    the material and the model's responses turn out to be.
    """
    n = len(section_char_counts)
    if n == 0 or not (want_summary or want_flashcards or want_discussion):
        # Nothing would actually be sent: either no sections are checked, or
        # no content type is requested (character list alone can't run — its
        # notes ride along on the per-section content calls).
        return CostEstimate(input_tokens=0, output_tokens=0)

    per_section_output = 0
    if want_summary:
        per_section_output += _OUTPUT_TOKENS_PER_FEATURE["summary"]
    if want_flashcards:
        per_section_output += _OUTPUT_TOKENS_PER_FEATURE["flashcards"]
    if want_discussion:
        per_section_output += _OUTPUT_TOKENS_PER_FEATURE["discussion"]
    if want_character_list:
        per_section_output += _OUTPUT_TOKENS_PER_FEATURE["character_notes"]
    if want_context_digest:
        per_section_output += _OUTPUT_TOKENS_PER_FEATURE["context_digest"]
    per_section_output = min(per_section_output, _SECTION_MAX_OUTPUT_TOKENS)

    input_tokens = 0
    output_tokens = 0
    for i, chars in enumerate(section_char_counts):
        extra_input = 0
        if want_context_digest and i > 0:
            # Every section after the first also carries the running recap
            # produced by the previous one — a small, roughly constant bump.
            extra_input = _CONTEXT_DIGEST_INPUT_TOKENS
        if want_chapter_continuity and i > 0:
            # Approximation noted above: treat every non-first section as if
            # it might be a later chapter part carrying forward an
            # already-covered list. Independent of want_context_digest — the
            # two features can be on at once and both add their own bump.
            extra_input += _CHAPTER_CONTINUITY_INPUT_TOKENS
        input_tokens += int(chars / _CHARS_PER_TOKEN) + _PROMPT_OVERHEAD_TOKENS + extra_input
        output_tokens += per_section_output

    if want_character_list:
        # The one extra consolidation call at the end of the run — small,
        # compact input (per-section notes, not original text), capped output.
        input_tokens += (n * _CONSOLIDATION_INPUT_PER_SECTION_TOKENS
                         + _CONSOLIDATION_INPUT_OVERHEAD_TOKENS)
        output_tokens += _CONSOLIDATION_MAX_OUTPUT_TOKENS

    return CostEstimate(input_tokens=input_tokens, output_tokens=output_tokens)

# content_type values: "auto" | "fiction" | "nonfiction"
_GENRE_INTROS = {
    "fiction": (
        "You're told in advance that this book is FICTION (a novel, story, "
        "play, etc.). Tailor everything you produce to fiction conventions: "
        "plot developments, characters and their motivations, settings, and "
        "themes."
    ),
    "nonfiction": (
        "You're told in advance that this book is NONFICTION (e.g. an essay, "
        "textbook, history, biography, or memoir). Tailor everything you "
        "produce to nonfiction conventions: key concepts, definitions, "
        "claims/arguments, evidence, and takeaways."
    ),
    "auto": (
        "Determine for yourself whether this section reads as fiction or "
        "nonfiction, and tailor everything you produce accordingly — for "
        "fiction, focus on plot/characters/themes; for nonfiction, focus on "
        "concepts/arguments/evidence."
    ),
}

_SUMMARY_INSTRUCTION = (
    "Produce a concise summary capturing the key events, ideas, or arguments "
    "in the section."
)

_FLASHCARD_INSTRUCTIONS = (
    "Produce flashcards for studying and remembering the material, in "
    "keeping with the genre guidance above, following these principles "
    "(drawn from spaced-repetition research on what actually makes cards "
    "memorable):\n"
    "- MINIMUM INFORMATION PRINCIPLE: each card should test exactly one "
    "atomic fact, and the answer should be as short as it can possibly be — "
    "ideally a single word, name, number, or short phrase, not a sentence. "
    "If a passage bundles several facts together (e.g. \"the Dead Sea is "
    "304m deep, the lowest body of water on Earth, and so salty that "
    "swimmers float effortlessly\"), write SEPARATE cards for each fact "
    "(its depth; its ranking; its salinity/buoyancy effect) rather than one "
    "card whose answer tries to hold all of it. Prefer several small, sharp "
    "cards over one dense one — this is the single most important thing "
    "that makes a card easy to remember.\n"
    "- LET THE MATERIAL SET THE COUNT: there is no fixed number to hit. A "
    "passage dense with discrete facts may genuinely warrant fifteen or "
    "more atomic cards; a thin passage may warrant only a couple. For "
    "sections with nothing worth memorizing — a table of contents, an "
    "index, an acknowledgements or copyright page, pure scene-setting with "
    "no durable facts — producing zero flashcards is the CORRECT outcome. "
    "Never pad with trivial, vague, or redundant cards just to reach a "
    "quota; an empty flashcards list is far better than a weak one.\n"
    "- AVOID SETS AND ENUMERATIONS: don't write cards like \"What are the "
    "five causes of the war?\" or \"Name the founding members of the "
    "alliance\" — unordered groups like this are notoriously hard to recall "
    "as a block and easy to half-remember. Instead, either ask about each "
    "item on its own (\"What was one major cause of the war: the "
    "[specific cause]?\"), or, when the sequence or full membership "
    "genuinely matters, render it as a cloze card (see below) rather than "
    "a single recall-the-whole-list question.\n"
    "- REDUCE INTERFERENCE: phrase questions so they can't be confused with "
    "each other or answered correctly by guessing a similar-sounding fact "
    "from elsewhere in the section — when two facts are easily mixed up "
    "(similar names, dates, numbers), make each card's wording pin down "
    "exactly which one it's asking about.\n"
    "- CLOZE DELETION: when a fact reads most naturally as a sentence with "
    "one key term blanked out (a name, date, number, or technical term), "
    "you may produce a cloze card instead of a question/answer card. Write "
    "out the full sentence with the key term wrapped in Anki's cloze "
    "syntax, e.g. \"Mitochondria are the {{c1::powerhouse}} of the cell.\" "
    "Use {{c2::}}, {{c3::}}, etc. for additional deletions in the SAME card "
    "only when those facts are genuinely linked and worth testing together "
    "— otherwise make them separate cards. For a cloze card, set "
    "\"type\": \"cloze\", put the cloze sentence in \"front\", and either "
    "leave \"back\" empty or use it for a short bit of extra context to "
    "show alongside the answer. For an ordinary question/answer card, set "
    "\"type\": \"basic\" and keep the back concise (ideally one short "
    "phrase or sentence, never a paragraph)."
)

_DISCUSSION_INSTRUCTIONS = (
    "Produce a small set of open-ended discussion questions suitable for a "
    "reading group or classroom — questions that invite analysis, "
    "interpretation, or debate rather than simple recall (distinct in spirit "
    "from flashcard recall questions, if both are being produced). Write only "
    "2-3 questions for this section: resist the urge to cover everything that "
    "happened, and instead pick just the 2-3 moments, choices, or ideas most "
    "worth a group's time — the ones with real interpretive depth or room for "
    "disagreement. Each question should be sharply focused on one specific "
    "thing (a character's choice, a passage's implication, a tension the "
    "section raises) rather than broad or multi-part (avoid \"…and how does "
    "this relate to X, Y, and Z?\" stacking). A few excellent questions beat "
    "many average ones — quality and focus matter far more than quantity here, "
    "in keeping with the genre guidance above."
)

# Per-section character-note extraction. This is intentionally lightweight —
# it rides along on the section call you're already making (a small bump in
# output tokens) rather than triggering any extra API calls. The notes are
# later combined, across all sections, into one full-book character guide via
# `consolidate_character_list` — a single additional call regardless of how
# long the book is.
_CHARACTER_NOTES_INSTRUCTION = (
    "Additionally, note any named people who have a meaningful presence in "
    "*this section specifically* — skip anyone only mentioned in passing. "
    "In fiction this means characters; in nonfiction (history, biography, "
    "memoir, journalism, etc.) it means the real people the material centers "
    "on — historical figures, subjects, sources, whoever the narrative "
    "actually follows. For each, write a brief 1-2 sentence note on what "
    "they do, reveal, decide, or how they change here (in nonfiction terms: "
    "what role they play in the events or argument of this section). Keep "
    "this list focused: roughly 6 people at most for this section, "
    "prioritizing whoever matters most to what happens in it. These notes "
    "will later be merged across all sections into a single full-book guide, "
    "so favor what's new or notable in this section over general description "
    "of who the person is."
)

# Optional "carry context forward" feature — off by default; the GUI exposes
# it as a checkbox. When enabled, each section's call both *receives* the
# running recap built by the previous section's call (see `_build_user_message`)
# and *produces* an updated one for the next — a self-maintaining rolling
# digest that rides along on the calls you're already making (no extra API
# calls, and no unbounded growth, since each digest is independently capped).
_ROLLING_DIGEST_INSTRUCTION = (
    "Additionally, maintain a brief running digest of the story so far, to be "
    "handed forward as background for whoever processes the next section "
    "(it won't be shown to the reader, so don't treat it as a deliverable in "
    "its own right). If a recap of earlier sections was provided to you above, "
    "treat it as your starting point and fold in what happens in *this* "
    "section — updating, replacing, or dropping earlier details as needed so "
    "the digest reflects the story's current state rather than just piling on. "
    "If no recap was provided, start one from this section. Keep it compact "
    "regardless of how far into the book this is — roughly 4-6 sentences "
    "covering whichever events, characters, and open threads matter most for "
    "understanding what comes next."
)

# Optional "avoid repeating across chapter parts" feature — off by default;
# the GUI exposes it as its own checkbox, separate from the whole-book rolling
# context above. It targets a specific, narrower problem: a single chapter
# that had to be split into several pieces (titled "... (part 1 of 3)" etc.)
# gets sent to Claude as multiple independent calls, each blind to what the
# others produced — which tends to yield flashcards and discussion questions
# that retest the same handful of facts or angles from slightly different
# wording. Unlike the rolling digest, this needs no extra model output: the
# caller (see ChapterContinuityTracker) already has the actual flashcards and
# questions produced for earlier parts of the same chapter on hand, and simply
# hands that list forward as something to avoid repeating — see
# _build_user_message for how it's framed in the prompt.
_CHAPTER_CONTINUITY_INSTRUCTION = (
    "This section is one piece of a larger chapter that had to be split for "
    "processing — you may be looking at the middle or tail end of a longer "
    "whole. If a list of flashcard concepts and/or discussion questions "
    "already produced for EARLIER PARTS OF THIS SAME CHAPTER appears below, "
    "treat those as already covered and off-limits for repetition: don't "
    "write new cards or questions that retest the same fact, revisit the "
    "same scene, or re-ask the same question in different words. Focus on "
    "what's distinct, new, or different in the material actually in front of "
    "you — there's no need to re-establish things the earlier parts already "
    "handled."
)


def _build_system_prompt(
    include_summary: bool,
    include_flashcards: bool,
    include_discussion: bool,
    content_type: str = "auto",
    include_character_notes: bool = False,
    include_context_digest: bool = False,
    include_chapter_continuity: bool = False,
) -> str:
    genre_intro = _GENRE_INTROS.get(content_type, _GENRE_INTROS["auto"])
    parts = [
        "You are a study-aid assistant. You will be given one section/chapter "
        "of a book. " + genre_intro
    ]
    fields = []

    if include_summary:
        parts.append(_SUMMARY_INSTRUCTION)
        fields.append('"summary": "..."')
    if include_flashcards:
        parts.append(_FLASHCARD_INSTRUCTIONS)
        fields.append(
            '"flashcards": [{"type": "basic or cloze", "front": "question, '
            'prompt, or cloze sentence", "back": "answer, or extra context '
            'for a cloze card (may be empty)"}, ...] (an empty array is '
            'correct when nothing in this section is worth memorizing)'
        )
    if include_discussion:
        parts.append(_DISCUSSION_INSTRUCTIONS)
        fields.append('"discussion_questions": ["...", ...]')
    if include_character_notes:
        parts.append(_CHARACTER_NOTES_INSTRUCTION)
        fields.append('"character_notes": [{"name": "...", "note": "..."}, ...]')
    if include_context_digest:
        parts.append(_ROLLING_DIGEST_INSTRUCTION)
        fields.append('"context_digest": "..."')
    if include_chapter_continuity:
        parts.append(_CHAPTER_CONTINUITY_INSTRUCTION)

    parts.append(
        "Respond with ONLY a JSON object, no other text, in exactly this shape:\n"
        "{" + ", ".join(fields) + "}"
    )
    return "\n\n".join(parts)


def _build_user_message(
    section_title: str,
    section_text: str,
    prior_context: str | None = None,
    prior_chapter_flashcard_fronts: list[str] | None = None,
    prior_chapter_discussion_questions: list[str] | None = None,
) -> str:
    """Builds the per-call user message.

    `prior_context`, when provided (the whole-book rolling digest carried
    forward from the previous section), is framed explicitly as background —
    not the main event — so Claude weighs the actual section text
    appropriately rather than just summarizing the recap.

    `prior_chapter_flashcard_fronts` / `prior_chapter_discussion_questions`,
    when provided (by ChapterContinuityTracker, only for parts after the
    first in a multi-part chapter), are framed as a concrete "already
    covered, don't repeat" list — distinct from the recap above, and not
    something Claude needs to fold in or maintain; it's just told to steer
    around it. See _CHAPTER_CONTINUITY_INSTRUCTION for the matching framing
    in the system prompt."""
    parts = []
    if prior_context:
        parts.append(
            "Recap of the story so far, for background only (don't repeat, "
            "summarize, or grade this back to me — just use it to understand "
            "context the section below may assume):\n\n" + prior_context.strip()
        )
    if prior_chapter_flashcard_fronts or prior_chapter_discussion_questions:
        chapter_lines = [
            "Already produced for EARLIER PARTS of this same chapter — treat "
            "as covered, and don't write new cards or questions that retest "
            "or rephrase any of these:"
        ]
        if prior_chapter_flashcard_fronts:
            chapter_lines.append("\nFlashcard concepts already tested:")
            chapter_lines.extend(f"- {front}" for front in prior_chapter_flashcard_fronts)
        if prior_chapter_discussion_questions:
            chapter_lines.append("\nDiscussion questions already asked:")
            chapter_lines.extend(f"- {q}" for q in prior_chapter_discussion_questions)
        parts.append("\n".join(chapter_lines))
    parts.append(f"Section title: {section_title}\n\nSection text:\n{section_text}")
    return "\n\n---\n\n".join(parts)


@dataclass
class Flashcard:
    front: str
    back: str
    # "basic" (ordinary Q&A) or "cloze" (Anki-style {{c1::...}} fill-in-the-blank).
    # Cloze cards need a different Anki note type on import, so exporters key
    # off this to route each card appropriately — see exporter.py.
    card_type: str = "basic"

    @property
    def is_cloze(self) -> bool:
        return self.card_type == "cloze"


@dataclass
class CharacterNote:
    """One section's brief observation about a character — raw material that
    `consolidate_character_list` later merges across the whole book."""
    name: str
    note: str


@dataclass
class CharacterSummary:
    """A character's finished, full-book entry in the character guide."""
    name: str
    summary: str


_BACKEND_LABELS = {
    "anthropic": "Anthropic API",
    "ollama": "Ollama",
    "groq": "Groq",
}


@dataclass
class SectionResult:
    title: str
    summary: str
    flashcards: list[Flashcard] = field(default_factory=list)
    discussion_questions: list[str] = field(default_factory=list)
    character_notes: list[CharacterNote] = field(default_factory=list)
    # Rolling "story so far" recap, present only when the optional cross-section
    # context feature is on — the caller carries this forward as `prior_context`
    # to the next section's call (see _build_user_message / _generate_worker).
    context_digest: str = ""
    error: str | None = None
    # Human-readable label for the model that produced this result, e.g.
    # "claude-sonnet-4-6 (Anthropic API)" or "qwen3:8b (Ollama)". Empty when
    # the result is an error (no successful call was made).
    model_used: str = ""


class ChapterContinuityTracker:
    """Optional helper for the "avoid repeating flashcards/questions across
    chapter parts" feature — a narrower, opt-in alternative to the whole-book
    rolling digest above, aimed squarely at the case that prompted it: a
    chapter big enough that the parser had to cut it into "(part N of M)"
    pieces, where each piece would otherwise be generated in total isolation
    and likely re-test the same handful of standout facts or re-ask near-
    identical discussion questions.

    Unlike the rolling digest, this needs no extra model output at all — the
    orchestrator already has the actual flashcard fronts and discussion
    questions produced for earlier parts of the same chapter sitting in their
    SectionResults. This tracker just accumulates those, scoped to "the
    current chapter," and hands back what to pass forward as the next part
    comes up.

    Resets automatically the moment the title's base (the portion before
    " (part N of M)") changes — i.e. at every new chapter — so its memory
    stays bounded by chapter size rather than book size, and never needs the
    self-capping the whole-book digest requires.
    """

    def __init__(self):
        self._base_title: str | None = None
        self._flashcard_fronts: list[str] = []
        self._discussion_questions: list[str] = []

    def context_for(self, title: str) -> tuple[list[str] | None, list[str] | None]:
        """What to pass forward as `prior_chapter_flashcard_fronts` /
        `prior_chapter_discussion_questions` for the section called `title`.

        Returns (None, None) when there's nothing useful to pass — either
        `title` isn't part of a split chapter at all, or it's that chapter's
        first part (nothing has been produced yet to steer around). Also
        resets the tracker's running tally in both of those cases, so it
        starts clean for whatever chapter comes next.
        """
        m = PART_RE.match(title)
        if not m:
            self._reset(None)
            return None, None

        base_title = m.group(1)
        if base_title != self._base_title:
            self._reset(base_title)
            return None, None

        fronts = list(self._flashcard_fronts) if self._flashcard_fronts else None
        questions = list(self._discussion_questions) if self._discussion_questions else None
        return fronts, questions

    def record(self, title: str, flashcard_fronts: list[str], discussion_questions: list[str]) -> None:
        """Fold this part's actual output into the running chapter-scoped
        tally, so later parts of the same chapter are told about it. A no-op
        if `title` doesn't belong to the chapter currently being tracked
        (e.g. it's not a chapter part, or context_for already reset onto a
        new chapter and this call is for stale/out-of-order results)."""
        m = PART_RE.match(title)
        if not m or m.group(1) != self._base_title:
            return
        self._flashcard_fronts.extend(flashcard_fronts)
        self._discussion_questions.extend(discussion_questions)

    def _reset(self, base_title: str | None) -> None:
        self._base_title = base_title
        self._flashcard_fronts = []
        self._discussion_questions = []


def _extract_json(raw: str) -> dict:
    """Extract the first valid JSON object from a model response.

    Cloud models (Claude) typically return clean JSON; local models often
    wrap it in prose ("Sure! Here's the JSON:"), code fences, or trailing
    commentary. This tries several extraction strategies in sequence so both
    styles work without special-casing per model.
    """
    raw = raw.strip()

    # 0. Strip <think>...</think> reasoning blocks — Qwen3 and similar models
    #    sometimes emit these even when asked not to. Remove them first so they
    #    don't consume the entire response budget and hide the actual JSON.
    raw = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()

    # 1. Direct parse — the happy path (Claude's typical output).
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 2. Code fence — ```json ... ``` or ``` ... ``` anywhere in the text
    #    (the re.match version above was anchored to ^, missing preamble text).
    fence = re.search(r'```(?:json)?\s*(.*?)\s*```', raw, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3. Greedy {...} block — catches "Here is the JSON: {...}" patterns.
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # 4. Balanced-brace scan — last resort for responses where the model
    #    mixed in a stray '}' after the real object, breaking the greedy
    #    regex above.  Walk forward from the first '{', tracking depth, and
    #    try to parse each candidate closing point.
    start = raw.find('{')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start:i + 1])
                    except json.JSONDecodeError:
                        break  # Not valid JSON even at the balanced close

    raise json.JSONDecodeError("No valid JSON object found in model response", raw, 0)


def get_ollama_models() -> tuple[list[str], str | None]:
    """Return (model_names, error). Queries the local Ollama instance for its
    installed models. error is None on success; model_names is empty on failure.
    Uses a short timeout — the caller should treat a timeout as "Ollama not
    running" rather than letting it hang the GUI."""
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE_URL}/api/tags")
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode())
        names = [m["name"] for m in data.get("models", [])]
        return names, None
    except Exception as e:  # noqa: BLE001
        return [], str(e)


def _call_ollama(
    model: str,
    system_prompt: str,
    user_message: str,
    max_tokens: int = 2048,
) -> str:
    """One chat-completion call to the local Ollama instance via its
    OpenAI-compatible endpoint (/v1/chat/completions). Returns the assistant
    reply text. Uses a long timeout because local inference can be slow —
    300 s should be enough even for a large model on CPU for a typical
    section, but may need tuning for very long sections on slow hardware."""
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            # /no_think suppresses Qwen3's chain-of-thought reasoning blocks
            # (<think>...</think>). It's a no-op for models that don't support
            # it, so it's safe to send unconditionally.
            {"role": "user", "content": f"/no_think\n\n{user_message}"},
        ],
        "stream": False,
        "options": {"num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=None) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


def get_groq_models(api_key: str) -> tuple[list[str], str | None]:
    """Return (model_names, error) for the Groq API. Filters to chat/text
    models only — Groq also hosts audio and other modality models that
    wouldn't be useful here. error is None on success."""
    if not api_key:
        return [], "No Groq API key provided."
    try:
        req = urllib.request.Request(
            f"{GROQ_BASE_URL}/models",
            headers={
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "ebook-flashcards/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        # Groq returns all model types; keep only ones that are likely text/chat
        # models by excluding known non-chat model id patterns.
        exclude = ("whisper", "distil-whisper", "tts", "playai", "vision")
        names = sorted(
            m["id"] for m in data.get("data", [])
            if not any(x in m["id"].lower() for x in exclude)
        )
        return names, None
    except urllib.error.HTTPError as e:
        # Read the full response body for debugging — Groq usually includes a
        # helpful JSON message; log the raw body to the console regardless.
        try:
            raw_body = e.read().decode()
            print(f"[Groq /models] HTTP {e.code} body: {raw_body}", flush=True)
            body = json.loads(raw_body)
            msg = body.get("error", {}).get("message", "") or str(e)
        except Exception:
            msg = str(e)
        return [], f"HTTP {e.code}: {msg}"
    except Exception as e:  # noqa: BLE001
        return [], str(e)


def _call_groq(
    api_key: str,
    model: str,
    system_prompt: str,
    user_message: str,
    max_tokens: int = 4096,
) -> str:
    """One chat-completion call to the Groq API (OpenAI-compatible endpoint).
    Automatically retries on 429 rate-limit responses, respecting Groq's
    Retry-After header. Free-tier accounts allow ~30 req/min, so consecutive
    section calls will occasionally hit the limit — retrying is the right
    response rather than failing."""
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "max_tokens": max_tokens,
    }).encode()

    max_retries = 8
    for attempt in range(max_retries):
        req = urllib.request.Request(
            f"{GROQ_BASE_URL}/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "ebook-flashcards/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                # Groq includes a Retry-After header (seconds until the rate-
                # limit window resets). For short waits (per-minute limit) we
                # sleep and retry. For long waits (>120 s) the user has hit a
                # harder quota — daily token cap or similar — so we surface a
                # clear error rather than hanging silently for minutes.
                retry_after = e.headers.get("retry-after") or e.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else min(2 ** attempt + 1, 60)
                if wait > 120:
                    raise RuntimeError(
                        f"Groq rate limit: quota exceeded — server asked us to wait "
                        f"{wait:.0f}s ({wait/60:.1f} min). You've likely hit the free-tier "
                        f"daily token or request cap. Wait for the quota to reset (check "
                        f"console.groq.com for your usage), or switch to a paid plan."
                    ) from e
                print(
                    f"[Groq] Rate limited — waiting {wait:.0f}s "
                    f"(retry {attempt + 1}/{max_retries - 1})…",
                    flush=True,
                )
                time.sleep(wait)
                continue
            if e.code == 413:
                raise RuntimeError(
                    "Section too large for this Groq model (HTTP 413). "
                    "Try reducing 'Max chars/section' in the settings (e.g. to 4000–6000), "
                    "or switch to a model with a larger context window such as "
                    "llama-3.1-8b-instant or llama-3.3-70b-versatile."
                ) from e
            raise


def generate_section_content(
    api_key: str,
    section_title: str,
    section_text: str,
    include_summary: bool = True,
    include_flashcards: bool = True,
    include_discussion: bool = False,
    include_character_notes: bool = False,
    include_context_digest: bool = False,
    prior_context: str | None = None,
    prior_chapter_flashcard_fronts: list[str] | None = None,
    prior_chapter_discussion_questions: list[str] | None = None,
    content_type: str = "auto",
    model: str = DEFAULT_MODEL,
    backend: str = "anthropic",
) -> SectionResult:
    """Call Claude once for a single section. Each of summary / flashcards /
    discussion questions is generated only if requested — at least one must be.
    `include_character_notes` additionally asks for brief per-section character
    observations (rides along on this same call; see `consolidate_character_list`
    for how these get merged into a full-book character guide afterward).

    `include_context_digest` / `prior_context` together implement an *optional*,
    off-by-default "carry story context forward" feature: when enabled, the
    caller passes in the running recap produced by the previous section's call
    (`prior_context`, or None for the first section), and this call both uses
    it as background and produces an updated recap back in
    `SectionResult.context_digest` for the caller to pass to the next one. This
    rides along on the calls you're already making — no extra API calls — and
    each digest is independently length-capped, so it doesn't grow unbounded
    over a long book. `prior_context` is ignored unless `include_context_digest`
    is also set.

    `prior_chapter_flashcard_fronts` / `prior_chapter_discussion_questions`
    implement a second, independent *optional* feature — "avoid repeating
    cards/questions across a chapter's parts" — aimed at a narrower problem
    than the rolling digest above: a single chapter that had to be split into
    several pieces gets sent as multiple isolated calls, which tends to
    produce overlapping flashcards/questions across those pieces. Rather than
    asking the model to maintain anything, the caller (see
    ChapterContinuityTracker) simply hands forward the actual flashcard fronts
    and discussion questions already produced for earlier parts of the *same*
    chapter, and this call is told to steer away from repeating them. Pass
    None for both (the default) to leave this off; they're independent of
    `include_context_digest` and can be used together or separately.

    `content_type` may be "auto" (let Claude infer), "fiction", or "nonfiction"
    to skip that inference step. Returns a SectionResult; on failure, `error`
    is set and the rest is empty."""
    if not (include_summary or include_flashcards or include_discussion):
        return SectionResult(
            title=section_title, summary="",
            error="Nothing was selected to generate (enable summary, flashcards, and/or discussion questions).",
        )

    # The chapter-continuity instruction is only worth the prompt overhead
    # when there's actually something to steer around — e.g. on the first
    # part of a chapter (nothing produced yet) it would be a no-op aside.
    chapter_fronts = prior_chapter_flashcard_fronts or None
    chapter_questions = prior_chapter_discussion_questions or None
    include_chapter_continuity = bool(chapter_fronts or chapter_questions)

    system_prompt = _build_system_prompt(
        include_summary, include_flashcards, include_discussion, content_type,
        include_character_notes, include_context_digest, include_chapter_continuity,
    )
    user_message = _build_user_message(
        section_title, section_text,
        prior_context=prior_context if include_context_digest else None,
        prior_chapter_flashcard_fronts=chapter_fronts,
        prior_chapter_discussion_questions=chapter_questions,
    )

    try:
        if backend == "ollama":
            if not model:
                return SectionResult(title=section_title, summary="",
                                     error="No Ollama model selected.")
            raw_text = _call_ollama(model, system_prompt, user_message, max_tokens=4096)
        elif backend == "groq":
            if not api_key:
                return SectionResult(title=section_title, summary="",
                                     error="No Groq API key configured.")
            if not model:
                return SectionResult(title=section_title, summary="",
                                     error="No Groq model selected.")
            raw_text = _call_groq(api_key, model, system_prompt, user_message, max_tokens=4096)
        else:
            try:
                import anthropic
            except ImportError:
                return SectionResult(
                    title=section_title, summary="",
                    error="The 'anthropic' package isn't installed. Run: pip install anthropic",
                )
            if not api_key:
                return SectionResult(title=section_title, summary="",
                                     error="No Anthropic API key configured.")
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            raw_text = "".join(
                block.text for block in response.content if hasattr(block, "text")
            )
        parsed = _extract_json(raw_text)

        summary = str(parsed.get("summary", "")).strip() if include_summary else ""

        cards: list[Flashcard] = []
        if include_flashcards:
            for c in parsed.get("flashcards", []):
                front = str(c.get("front", "")).strip()
                back = str(c.get("back", "")).strip()
                if not front:
                    continue
                card_type = str(c.get("type", "basic")).strip().lower()
                if card_type not in ("basic", "cloze"):
                    card_type = "basic"
                # Cloze cards carry their answer inline (in the {{c1::...}}
                # deletion), so an empty "back" is fine — it's just optional
                # extra context. Basic Q&A cards need both halves to be useful.
                if card_type == "basic" and not back:
                    continue
                cards.append(Flashcard(front=front, back=back, card_type=card_type))

        questions: list[str] = []
        if include_discussion:
            questions = [str(q).strip() for q in parsed.get("discussion_questions", []) if str(q).strip()]

        notes: list[CharacterNote] = []
        if include_character_notes:
            notes = [
                CharacterNote(name=str(c.get("name", "")).strip(), note=str(c.get("note", "")).strip())
                for c in parsed.get("character_notes", [])
                if c.get("name") and c.get("note")
            ]

        digest = str(parsed.get("context_digest", "")).strip() if include_context_digest else ""

        model_label = f"{model} ({_BACKEND_LABELS.get(backend, backend)})"
        return SectionResult(
            title=section_title, summary=summary, flashcards=cards,
            discussion_questions=questions, character_notes=notes,
            context_digest=digest, model_used=model_label,
        )
    except Exception as e:  # noqa: BLE001 — surface any API/parsing error to the GUI
        return SectionResult(title=section_title, summary="", error=str(e))


# Backwards-compatible alias
generate_summary_and_flashcards = generate_section_content


# --------------------------------------------------------- character guide

# This is the one *additional* API call the character-list feature makes,
# regardless of how long the book is. It runs once, after every checked
# section has already been processed, and works only from the compact notes
# gathered along the way (a few words per character per section) — never the
# raw section text. That keeps the input small even for very long or
# character-heavy books, while still letting Claude see how each character
# develops across the whole story before writing their final entry.
_CHARACTER_LIST_SYSTEM_PROMPT = (
    "You are building a guide to the key people in \"{book_title}\". In a "
    "novel or other fiction that means its main characters; in nonfiction "
    "(history, biography, memoir, journalism, etc.) it means the real people "
    "the material centers on — historical figures, subjects, sources, "
    "whoever the narrative actually follows. You'll be given short notes "
    "about them gathered section-by-section across the whole book — the same "
    "person may appear many times, sometimes referred to by different names, "
    "nicknames, or titles.\n\n"
    "Your job:\n"
    "1. Merge notes that refer to the same person.\n"
    "2. Identify the MAIN figures only — the ones genuinely central to the "
    "story or material. If many named people appear, judiciously narrow the "
    "list to roughly the 8-15 most important; it's fine, and often better, "
    "to leave minor or incidental figures out entirely rather than pad the "
    "list.\n"
    "3. For each, write one well-rounded paragraph (roughly 3-6 sentences) "
    "describing their role across the book as a whole — who they are, key "
    "relationships, and their arc or significance — synthesizing the notes "
    "rather than just concatenating them.\n\n"
    "Respond with ONLY a JSON object, no other text, in exactly this shape:\n"
    "{{\"characters\": [{{\"name\": \"...\", \"summary\": \"...\"}}, ...]}}\n"
    "List them roughly in order of importance, most central first."
)


def consolidate_character_list(
    api_key: str,
    book_title: str,
    notes_by_section: list[tuple[str, list[CharacterNote]]],
    model: str = DEFAULT_MODEL,
    backend: str = "anthropic",
) -> tuple[list[CharacterSummary], str | None]:
    """Make the one additional API call that merges per-section character
    notes (gathered during normal generation) into a single full-book
    character guide. Works with both the Anthropic and Ollama backends.
    Returns (characters, error); characters is empty and error is set on
    failure."""
    lines: list[str] = []
    for title, notes in notes_by_section:
        if not notes:
            continue
        lines.append(f"Section: {title}")
        for n in notes:
            lines.append(f"- {n.name}: {n.note}")
        lines.append("")
    digest = "\n".join(lines).strip()
    if not digest:
        return [], "No character notes were gathered from the generated sections."

    system_prompt = _CHARACTER_LIST_SYSTEM_PROMPT.format(book_title=book_title or "this book")
    user_content = f"Section-by-section character notes:\n\n{digest}"

    try:
        if backend == "ollama":
            if not model:
                return [], "No Ollama model selected."
            raw_text = _call_ollama(model, system_prompt, user_content, max_tokens=4096)
        elif backend == "groq":
            if not api_key:
                return [], "No Groq API key configured."
            if not model:
                return [], "No Groq model selected."
            raw_text = _call_groq(api_key, model, system_prompt, user_content, max_tokens=4096)
        else:
            try:
                import anthropic
            except ImportError:
                return [], "The 'anthropic' package isn't installed. Run: pip install anthropic"
            if not api_key:
                return [], "No Anthropic API key configured."
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
            raw_text = "".join(
                block.text for block in response.content if hasattr(block, "text")
            )

        parsed = _extract_json(raw_text)
        characters = [
            CharacterSummary(
                name=str(c.get("name", "")).strip(),
                summary=str(c.get("summary", "")).strip(),
            )
            for c in parsed.get("characters", [])
            if c.get("name") and c.get("summary")
        ]
        return characters, None
    except Exception as e:  # noqa: BLE001
        return [], str(e)
