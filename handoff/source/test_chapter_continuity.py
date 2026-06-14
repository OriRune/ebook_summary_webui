"""Unit tests for the "avoid repeating flashcards/questions across chapter
parts" feature -- ChapterContinuityTracker plus the prompt-building / cost-
estimate plumbing that threads it through (_build_system_prompt,
_build_user_message, generate_section_content's signature, estimate_run_cost).
Run with:

    python -m unittest test_chapter_continuity -v

These exercise only the pure, API-free parts (the tracker itself and the
prompt/cost helpers), so they run without an `anthropic` install or network
access -- `llm_client` only imports `anthropic` lazily, inside
generate_section_content.
"""

from __future__ import annotations

import unittest

from llm_client import (
    ChapterContinuityTracker,
    _build_system_prompt,
    _build_user_message,
    _CHAPTER_CONTINUITY_INSTRUCTION,
    estimate_run_cost,
    _CHAPTER_CONTINUITY_INPUT_TOKENS,
    _CONTEXT_DIGEST_INPUT_TOKENS,
)


# --------------------------------------------------------------------------- #
# ChapterContinuityTracker -- the stateful per-run helper that recognizes
# "(part N of M)" titles, hands back what earlier parts of the SAME chapter
# already produced, and resets at chapter boundaries.
# --------------------------------------------------------------------------- #

class ChapterContinuityTrackerTests(unittest.TestCase):

    def test_non_part_title_returns_nothing_and_resets(self):
        tracker = ChapterContinuityTracker()
        fronts, questions = tracker.context_for("Chapter 5")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

    def test_first_part_of_chapter_returns_nothing(self):
        tracker = ChapterContinuityTracker()
        fronts, questions = tracker.context_for("Chapter 5 (part 1 of 3)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

    def test_later_part_receives_earlier_parts_output(self):
        tracker = ChapterContinuityTracker()

        # Part 1: nothing to carry forward yet
        fronts, questions = tracker.context_for("Chapter 5 (part 1 of 3)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)
        tracker.record(
            "Chapter 5 (part 1 of 3)",
            ["What year did the war start?", "Who led the rebellion?"],
            ["Why might the general have hesitated at the river?"],
        )

        # Part 2: should now see part 1's output
        fronts, questions = tracker.context_for("Chapter 5 (part 2 of 3)")
        self.assertEqual(fronts, ["What year did the war start?", "Who led the rebellion?"])
        self.assertEqual(questions, ["Why might the general have hesitated at the river?"])
        tracker.record("Chapter 5 (part 2 of 3)", ["What treaty ended the conflict?"], [])

        # Part 3: should see the cumulative tally from parts 1 and 2
        fronts, questions = tracker.context_for("Chapter 5 (part 3 of 3)")
        self.assertEqual(
            fronts,
            ["What year did the war start?", "Who led the rebellion?", "What treaty ended the conflict?"],
        )
        self.assertEqual(questions, ["Why might the general have hesitated at the river?"])

    def test_resets_at_chapter_boundary(self):
        tracker = ChapterContinuityTracker()
        tracker.context_for("Chapter 5 (part 1 of 2)")
        tracker.record("Chapter 5 (part 1 of 2)", ["Card about chapter 5"], ["Question about chapter 5"])
        tracker.context_for("Chapter 5 (part 2 of 2)")
        tracker.record("Chapter 5 (part 2 of 2)", ["Another chapter 5 card"], [])

        # New chapter, also split -- should start fresh, not see chapter 5's tally
        fronts, questions = tracker.context_for("Chapter 6 (part 1 of 2)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

        # ...and its part 2 should only see chapter 6's own output
        tracker.record("Chapter 6 (part 1 of 2)", ["Card about chapter 6"], [])
        fronts, questions = tracker.context_for("Chapter 6 (part 2 of 2)")
        self.assertEqual(fronts, ["Card about chapter 6"])
        self.assertIsNone(questions)

    def test_resets_when_a_non_split_section_intervenes(self):
        tracker = ChapterContinuityTracker()
        tracker.context_for("Chapter 5 (part 1 of 2)")
        tracker.record("Chapter 5 (part 1 of 2)", ["Card A"], ["Question A"])

        # An ordinary, non-split section in between
        fronts, questions = tracker.context_for("Chapter 6")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

        # If "Chapter 5 (part 2 of 2)" somehow showed up after that (out of
        # order), the tracker has moved on -- nothing carries forward, and the
        # stale record() call is a no-op rather than corrupting later state.
        tracker.record("Chapter 5 (part 2 of 2)", ["Card B"], [])
        fronts, questions = tracker.context_for("Chapter 7 (part 1 of 2)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

    def test_record_is_noop_for_titles_outside_current_chapter(self):
        tracker = ChapterContinuityTracker()
        # Nothing started yet -- recording shouldn't seed any state
        tracker.record("Chapter 5 (part 1 of 3)", ["Stray card"], [])
        fronts, questions = tracker.context_for("Chapter 5 (part 1 of 3)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

        # Recording for a different chapter than the one being tracked
        tracker.context_for("Chapter 5 (part 1 of 3)")
        tracker.record("Chapter 9 (part 1 of 2)", ["Wrong-chapter card"], [])
        fronts, questions = tracker.context_for("Chapter 5 (part 2 of 3)")
        self.assertIsNone(fronts)
        self.assertIsNone(questions)

    def test_returns_independent_copies_each_call(self):
        """context_for should hand back snapshots -- mutating the returned
        list must not corrupt the tracker's running tally."""
        tracker = ChapterContinuityTracker()
        tracker.context_for("Chapter 1 (part 1 of 2)")
        tracker.record("Chapter 1 (part 1 of 2)", ["Original card"], ["Original question"])

        fronts, questions = tracker.context_for("Chapter 1 (part 2 of 2)")
        fronts.append("Tampered card")
        questions.append("Tampered question")

        tracker.record("Chapter 1 (part 2 of 2)", ["Real new card"], [])
        self.assertNotIn("Tampered card", tracker._flashcard_fronts)
        self.assertNotIn("Tampered question", tracker._discussion_questions)


# --------------------------------------------------------------------------- #
# _build_system_prompt -- the optional instruction should be omitted by
# default, included when flagged, add no new JSON field (this feature produces
# no model output of its own), and coexist independently with the rolling
# whole-book digest's instruction.
# --------------------------------------------------------------------------- #

class SystemPromptTests(unittest.TestCase):
    def test_instruction_omitted_by_default(self):
        prompt = _build_system_prompt(True, True, True)
        self.assertNotIn(_CHAPTER_CONTINUITY_INSTRUCTION, prompt)

    def test_instruction_included_when_flagged(self):
        prompt = _build_system_prompt(True, True, True, include_chapter_continuity=True)
        self.assertIn(_CHAPTER_CONTINUITY_INSTRUCTION, prompt)

    def test_instruction_adds_no_json_field(self):
        without = _build_system_prompt(True, True, True)
        with_continuity = _build_system_prompt(True, True, True, include_chapter_continuity=True)
        without_shape = without.rsplit("Respond with ONLY", 1)[1]
        with_shape = with_continuity.rsplit("Respond with ONLY", 1)[1]
        self.assertEqual(without_shape, with_shape)

    def test_independent_of_context_digest(self):
        """Both optional instructions can be present together."""
        prompt = _build_system_prompt(
            True, True, True,
            include_context_digest=True,
            include_chapter_continuity=True,
        )
        self.assertIn(_CHAPTER_CONTINUITY_INSTRUCTION, prompt)
        self.assertIn('"context_digest": "..."', prompt)


# --------------------------------------------------------------------------- #
# _build_user_message -- the "already covered" block should appear only when
# there's something to carry, be framed distinctly from the whole-book recap,
# and the two should be able to coexist.
# --------------------------------------------------------------------------- #

class UserMessageTests(unittest.TestCase):
    def test_no_block_when_nothing_to_carry(self):
        msg = _build_user_message("Chapter 5 (part 1 of 3)", "text")
        self.assertNotIn("Already produced for EARLIER PARTS", msg)

    def test_block_includes_flashcard_fronts(self):
        msg = _build_user_message(
            "Chapter 5 (part 2 of 3)", "text",
            prior_chapter_flashcard_fronts=["What year did the war start?"],
        )
        self.assertIn("Already produced for EARLIER PARTS", msg)
        self.assertIn("Flashcard concepts already tested:", msg)
        self.assertIn("- What year did the war start?", msg)
        self.assertNotIn("Discussion questions already asked:", msg)

    def test_block_includes_discussion_questions(self):
        msg = _build_user_message(
            "Chapter 5 (part 2 of 3)", "text",
            prior_chapter_discussion_questions=["Why might the general have hesitated?"],
        )
        self.assertIn("Discussion questions already asked:", msg)
        self.assertIn("- Why might the general have hesitated?", msg)
        self.assertNotIn("Flashcard concepts already tested:", msg)

    def test_block_can_combine_with_rolling_recap(self):
        """The whole-book recap and the chapter-scoped 'already covered' list
        are independent and can both be present -- distinctly framed, recap first."""
        msg = _build_user_message(
            "Chapter 5 (part 2 of 3)", "text",
            prior_context="Aria confronted the council in chapter 4.",
            prior_chapter_flashcard_fronts=["What treaty ended the conflict?"],
        )
        self.assertIn("Recap of the story so far", msg)
        self.assertIn("Already produced for EARLIER PARTS", msg)
        self.assertLess(msg.index("Recap of the story so far"),
                        msg.index("Already produced for EARLIER PARTS"))

    def test_section_text_always_present(self):
        msg = _build_user_message(
            "Chapter 5 (part 2 of 3)", "the actual section text",
            prior_chapter_flashcard_fronts=["card"],
        )
        self.assertIn("Section title: Chapter 5 (part 2 of 3)", msg)
        self.assertIn("the actual section text", msg)


# --------------------------------------------------------------------------- #
# estimate_run_cost -- off by default (no change to the estimate), bumps input
# (never output, since the feature produces no model output of its own) for
# every section after the first, and stacks additively alongside the rolling
# context-digest bump when both are enabled.
# --------------------------------------------------------------------------- #

class EstimateRunCostTests(unittest.TestCase):
    def _base_kwargs(self):
        return dict(want_summary=True, want_flashcards=True, want_discussion=True,
                    want_character_list=False)

    def test_off_by_default_no_change(self):
        without = estimate_run_cost([5000, 5000, 5000], **self._base_kwargs())
        with_off = estimate_run_cost([5000, 5000, 5000], want_chapter_continuity=False,
                                     **self._base_kwargs())
        self.assertEqual(without.input_tokens, with_off.input_tokens)

    def test_first_section_unaffected_later_sections_bumped(self):
        plain = estimate_run_cost([5000, 5000, 5000], **self._base_kwargs())
        bumped = estimate_run_cost([5000, 5000, 5000], want_chapter_continuity=True,
                                   **self._base_kwargs())
        # Exactly two extra bumps (sections at index 1 and 2)
        self.assertEqual(
            bumped.input_tokens - plain.input_tokens,
            2 * _CHAPTER_CONTINUITY_INPUT_TOKENS,
        )

    def test_stacks_additively_with_context_digest(self):
        neither = estimate_run_cost([5000, 5000], **self._base_kwargs())
        both = estimate_run_cost([5000, 5000], want_context_digest=True,
                                 want_chapter_continuity=True, **self._base_kwargs())
        # The one later section (index 1) gets both bumps
        self.assertEqual(
            both.input_tokens - neither.input_tokens,
            _CONTEXT_DIGEST_INPUT_TOKENS + _CHAPTER_CONTINUITY_INPUT_TOKENS,
        )

    def test_does_not_change_output_tokens(self):
        """The feature produces no model output of its own -- it should bump
        input estimates only, never output."""
        plain = estimate_run_cost([5000, 5000], **self._base_kwargs())
        bumped = estimate_run_cost([5000, 5000], want_chapter_continuity=True,
                                   **self._base_kwargs())
        self.assertEqual(plain.output_tokens, bumped.output_tokens)


if __name__ == "__main__":
    unittest.main()
