# Ebook Flashcard Generator — Functional Specification

This document describes the complete feature set of the desktop application being rebuilt as a web app. The intent is to faithfully reproduce all behaviour while adapting the delivery medium.

---

## Overview

The application takes an ebook (or any long-form text document) as input, splits it into sections, and sends each section to an LLM to generate study aids: summaries, flashcards, discussion questions, a character/people guide, and a rolling story-context digest. Outputs are exported as Anki-importable CSV files and/or a formatted study guide (Markdown or Word).

---

## 1. File Input

### Supported formats
- `.epub` — parsed via ebooklib + BeautifulSoup; chapter structure extracted from HTML headings and epub item order
- `.txt` / `.md` / `.markdown` — heading-regex detection, then paragraph-chunk fallback
- `.pdf` — text extracted via pypdf; bookmark/outline tree used for chapter titles if present; falls back to heading-regex on the extracted text

### Scanned PDF detection
If fewer than 10% of PDF pages return any text, the file is rejected with a clear error message suggesting the user OCR it first.

### File open flow
1. User clicks "Open ebook…"
2. File picker opens filtered to supported extensions
3. File is parsed immediately
4. Section list populates with detected chapter/section titles and character counts
5. Title and author fields auto-populate from file metadata (epub DC metadata; PDF document-info dictionary; plain-text heuristic scan for "Title: …" / "Author: …" lines and markdown headings)
6. All per-run state (results, character list, checked sections) resets

---

## 2. Section List

### Display
- Each row: checkbox (include in generation), section title, status icon (blank / ✓ / ⚠)
- Scrollable; sections appear in book order

### Interactions
- **Check/uncheck individual sections** to include or exclude from the next Generate run
- **Check all / Uncheck all** buttons toggle every section at once
- **Select a section** (single click) to view its generated output in the result pane
- **Rename section** — inline rename; title stored in memory (does not write back to the file)
- **Merge with previous / Merge with next** — collapses two adjacent sections into one, concatenating their text. Titles of merged sections get "(part N of M)" suffixes renumbered
- **Clear result** — removes the stored result for the selected section and resets its status icon; it will be regenerated on the next run
- **Clear all results** — after confirmation, removes results for every section and resets all status icons; disables all export buttons

### "Max chars / section" setting
Integer input (default 9000). If a parsed section exceeds this, it is automatically subdivided at paragraph boundaries with "(part N of M)" appended to the title. The setting is applied at parse time and determines both the initial split and the cost estimate.

---

## 3. Content Options

### Content type selector
- Options: Auto-detect, Fiction, Nonfiction
- Controls which genre-specific prompt framing is used (see Prompts doc)
- Also gates the character list checkbox: only enabled when set to Fiction or Nonfiction (not Auto)

### Generate checkboxes (at least one required)
- **Summary** — concise paragraph capturing key events/ideas
- **Flashcards** — atomic Q&A and/or cloze-deletion cards per section
- **Discussion questions** — 2-3 open-ended questions per section
- **Create character list** — enabled only when content type is Fiction or Nonfiction; adds per-section character notes to each section call, plus one additional consolidation call at the end (see §6)
- **Carry story context forward** — optional rolling digest: each section receives the previous section's ~4-6 sentence story recap as background, and produces an updated one for the next

---

## 4. LLM Backend Selection

Three backends are available; exactly one is active at a time.

### Anthropic API
- API key entry (masked, saved locally to `~/.ebook_flashcards/config.json`)
- Model selector (string entry, defaults to `claude-sonnet-4-6`)
- Cost estimate shown for Anthropic runs: rough token count × list price (see §10)

### Ollama (local)
- No API key required
- Model dropdown populated by querying `http://localhost:11434/api/tags`
- Refresh button to re-query the model list
- Status label reports connection result
- No cost shown ("Free (local)")

### Groq
- API key entry (masked, saved locally)
- Model dropdown populated by querying the Groq `/v1/models` endpoint (non-chat models filtered out)
- Refresh button
- Status label reports connection result
- Cost shown as "Low (Groq pricing — see groq.com/pricing)"

### API key persistence
Keys are stored in `~/.ebook_flashcards/config.json` with 0600 permissions. On load, the saved key pre-fills the entry. Keys are never sent anywhere except the relevant API endpoint.

---

## 5. Generation

### "Generate for checked sections" button
Disabled while a run is in progress; also disabled if no ebook is loaded.

### Resume / skip logic
Before starting, the app filters the checked sections down to only those that do not already have a successful result. If all checked sections are already done, a status message is shown and no API calls are made.

When resuming a partial run:
- The character notes accumulated from all previously-successful sections are reconstructed and passed to the worker as the starting point for `notes_by_section`
- The last successful section's `context_digest` is passed as `initial_context` (the rolling recap seed) for the resuming worker

### Worker thread
Generation runs on a background thread. A thread-safe queue passes events back to the UI:
- `("result", (section_index, SectionResult))` — one section done
- `("character_list_started", None)` — consolidation call beginning
- `("character_list", (characters, error))` — consolidation call done
- `("done", elapsed_seconds)` — all sections complete
- `("stopped", elapsed_seconds)` — user cancelled

### Progress display
- Progress bar advances one tick per completed section
- Status label shows e.g. "Generating section 3 of 7…"
- During character list consolidation: "All sections done — building character list…"
- Elapsed time updates live; estimated remaining time computed from per-section average

### Stop button
Visible and active during generation. Sets a flag checked between sections; does not interrupt a section call already in flight.

### Rate limit handling (Groq)
On HTTP 429, reads the `Retry-After` header and sleeps that many seconds before retrying (up to 8 attempts). If `Retry-After` exceeds 120 seconds, raises an error explaining the daily quota has been hit, rather than blocking silently.

### HTTP 413 handling (Groq)
On HTTP 413 (payload too large), raises a clear error suggesting the user reduce Max chars/section or switch to a model with a larger context window.

### Section status marks
- ✓ green: section completed without error
- ⚠ amber: section failed (error stored in result)

---

## 6. Character / People Guide

### Per-section note gathering
When "Create character list" is checked, each section call additionally requests brief notes on named people who appear meaningfully in that section (up to ~6 people). Notes are compact (1-2 sentences per person) and section-scoped (not a full character description).

### Consolidation call
After all sections are processed, a single additional LLM call receives all the gathered per-section notes and produces a full-book character guide: 8-15 main figures, one paragraph each, ordered by importance. This call is separate from the section calls and uses the same backend/model.

### "Clear character list" button
Clears the stored character list and error so the next Generate run rebuilds it from scratch. Useful when an earlier partial run produced an incomplete character list.

### Display
The Characters tab shows the consolidated guide, or an explanatory message if not yet generated or if it failed.

---

## 7. Output Panes (Result View)

Selecting a section in the list populates four tabs:

### Summary tab
The LLM-generated summary paragraph. "Not generated" message if not included in the last run.

### Flashcards tab
Lists all cards for the selected section. Basic cards shown as "Q: … / A: …". Cloze cards shown with their `{{c1::…}}` syntax visible, followed by the "extra context" (back field) if any.

### Discussion tab
Numbered list of discussion questions.

### Characters tab
Book-level — the same consolidated character guide regardless of which section is selected. Shows all characters with their full-paragraph summaries.

---

## 8. Export

All export buttons are disabled until at least one section has a successful result. Buttons that require specific data (character notes, context notes) are also disabled until that data exists.

### Flashcard CSV (Anki Basic)
- Columns: `front`, `back`, `tags`
- Cloze cards excluded (they need a different Anki note type)
- Tags formatted as `Book_Title::Section_Title`
- For import: Anki → File → Import → map Column 1 = Front, Column 2 = Back, Column 3 = Tags, note type = Basic

### Flashcard CSV (Anki Cloze)
- Only generated if the run produced any cloze cards
- Columns: `text`, `back_extra`, `tags`
- For import: Anki → File → Import → map Column 1 = Text, Column 2 = Back Extra, Column 3 = Tags, note type = Cloze
- If no cloze cards exist, the button is disabled / export is skipped

### Study guide — Markdown
- Book title as H1
- Model attribution line (italic, below title): single model if uniform across sections; "multiple models" summary if mixed
- Character guide section (if generated)
- Per section: H2 heading, model attribution (if mixed), summary, flashcards, discussion questions
- Cloze cards displayed with `{{c1::…}}` syntax visible and a note explaining the format

### Study guide — Word (.docx)
- Same structure as Markdown but rendered with real Word styles: Heading 1/2, bold labels, bullet lists, italic runs
- Model attribution rendered as italic paragraph(s)
- Requires python-docx

### Export character notes
- Markdown file with per-section raw character notes (the compact section-scoped notes before consolidation)
- Useful for debugging the character list or inspecting what was gathered per section

### Export context notes
- Markdown file with per-section rolling context digests (the "story so far" recap produced by each section when "Carry story context forward" is enabled)

### Export filename convention
`{Author} - {Title}` if both are set; otherwise just `{Title}`, falling back to the filename stem. Export dialogs pre-fill this as the default filename.

---

## 9. UI / Display

### Dark mode
Toggle in the toolbar/settings area. Preference saved to config.json and restored on next launch. The entire colour scheme switches (background, foreground, widget colours).

### Cost estimate
Live readout below the options area. Updates whenever sections are checked/unchecked or content options change. Shows estimated input tokens, output tokens, and USD cost for Anthropic. For Ollama shows "Free (local)". For Groq shows a note to check groq.com/pricing.

### Section renaming
Inline: user clicks a rename button, enters a new title in a dialog, section list updates. Does not affect the stored section text.

---

## 10. Cost Estimation Logic

Pure arithmetic — no API calls. Based on:
- Section character count ÷ 3.5 chars/token + ~400 token prompt overhead per section
- Per-feature output token estimates: summary ~220, flashcards ~340, discussion ~90, character_notes ~240, context_digest ~110
- Rolling context adds ~110 input tokens per non-first section
- Chapter continuity adds ~90 input tokens per non-first section
- Character list consolidation: n_sections × 120 + 300 input tokens, ~4096 output cap
- Prices: $3/M input, $15/M output (Claude Sonnet 4.6 list pricing, mid-2026)

---

## 11. Chapter Continuity

Automatic feature (always on). When a chapter is split into parts (e.g. "Chapter 5 (part 1 of 3)"), the flashcard fronts and discussion questions already produced for earlier parts of the same chapter are passed forward to each subsequent part. The model is instructed not to repeat or rephrase what was already covered.

This is tracked by `ChapterContinuityTracker`, which:
- Detects `(part N of M)` suffixes in section titles
- Accumulates flashcard fronts and discussion questions per chapter
- Resets at chapter boundaries
- Produces no additional LLM output (the prior content is passed as input context only)
