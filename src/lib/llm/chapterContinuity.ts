/**
 * ChapterContinuityTracker — ported from llm_client.py.
 *
 * Accumulates the flashcard fronts and discussion questions produced for the
 * earlier parts of a split chapter ("... (part N of M)"), so later parts can be
 * told what's already covered and avoid repeating it. Resets automatically the
 * moment the title's base (the portion before " (part N of M)") changes — i.e.
 * at every new chapter — and is a complete no-op for sections that aren't part
 * of a split chapter. One instance per generation run.
 */
import { PART_RE } from "@/lib/partRe";

export class ChapterContinuityTracker {
  private baseTitle: string | null = null;
  private flashcardFronts: string[] = [];
  private discussionQuestions: string[] = [];

  /**
   * What to pass forward as priorChapterFlashcardFronts /
   * priorChapterDiscussionQuestions for the section titled `title`. Returns
   * [null, null] when there's nothing useful to pass (not a split chapter, or
   * its first part) — and resets the running tally in those cases.
   */
  contextFor(title: string): [string[] | null, string[] | null] {
    const m = PART_RE.exec(title);
    if (!m) {
      this.reset(null);
      return [null, null];
    }

    const base = m[1];
    if (base !== this.baseTitle) {
      this.reset(base);
      return [null, null];
    }

    // Return independent copies so callers can't corrupt internal state.
    const fronts = this.flashcardFronts.length > 0 ? [...this.flashcardFronts] : null;
    const questions =
      this.discussionQuestions.length > 0 ? [...this.discussionQuestions] : null;
    return [fronts, questions];
  }

  /**
   * Fold this part's actual output into the running chapter-scoped tally. A
   * no-op if `title` doesn't belong to the chapter currently being tracked.
   */
  record(title: string, flashcardFronts: string[], discussionQuestions: string[]): void {
    const m = PART_RE.exec(title);
    if (!m || m[1] !== this.baseTitle) {
      return;
    }
    this.flashcardFronts.push(...flashcardFronts);
    this.discussionQuestions.push(...discussionQuestions);
  }

  private reset(baseTitle: string | null): void {
    this.baseTitle = baseTitle;
    this.flashcardFronts = [];
    this.discussionQuestions = [];
  }
}
