# Test Cases

Concrete inputs and expected outputs for each major component. These are drawn from the existing unit tests plus additional cases that cover edge conditions. They should be ported to the web app's test suite.

---

## 1. Parser — Section Detection

### 1.1 Heading regex detection (plain text)

**Input:**
```
Chapter 1: The Storm

It was a dark and stormy night. The wind howled through the trees.
The rain lashed against the windows without mercy.

Chapter 2: The Morning After

The sun rose hesitantly over the hills. Birds resumed their routines
as if nothing had happened.
```

**Expected:** 2 sections
- `Section(title="Chapter 1: The Storm", text="It was a dark and stormy night...")`
- `Section(title="Chapter 2: The Morning After", text="The sun rose hesitantly...")`

---

### 1.2 Markdown heading detection

**Input:**
```
## Introduction

This book explores the nature of memory and identity.
Research suggests that...

## Chapter One: First Principles

The earliest experiments date from 1879...
```

**Expected:** 2 sections
- `Section(title="Introduction", text="This book explores...")`  _(# stripped)_
- `Section(title="Chapter One: First Principles", text="The earliest experiments...")`

---

### 1.3 Roman numeral headings

**Input:**
```
I

It was the best of times, it was the worst of times.

II

It was the age of wisdom, it was the age of foolishness.
```

**Expected:** 2 sections titled `"I"` and `"II"`.

**Counter-case (must NOT match):** `"LIVID"`, `"MILD"`, `"CIVIL"` alone on a line should not be treated as Roman numerals.

---

### 1.4 Paragraph-chunk fallback (no detectable headings)

**Input:** Plain prose text ~25 000 chars with no heading-like lines, `max_chars=9000`.

**Expected:** 3 sections titled `"Part 1"`, `"Part 2"`, `"Part 3"`. Each section ≤ 9000 chars (split at paragraph boundaries, so exact size varies). No section > 9000 chars.

---

### 1.5 Oversized section subdivision

**Input:** A file with two headings. Section 1 body = 25 000 chars. Section 2 body = 3 000 chars. `max_chars=9000`.

**Expected:** 4 sections:
- `"Chapter 1 (part 1 of 3)"` — ≤ 9000 chars
- `"Chapter 1 (part 2 of 3)"` — ≤ 9000 chars
- `"Chapter 1 (part 3 of 3)"` — remainder
- `"Chapter 2"` — 3 000 chars, untouched

---

### 1.6 Project Gutenberg boilerplate stripping

**Input:** Text file beginning with `*** START OF THE PROJECT GUTENBERG EBOOK...` and ending with `*** END OF THE PROJECT GUTENBERG EBOOK...`

**Expected:** Boilerplate lines absent from all sections. First section begins with the first real content line.

---

### 1.7 Scanned PDF rejection

**Input:** A PDF where every page's `extract_text()` returns `""` or whitespace-only.

**Expected:** `RuntimeError` with message containing `"scanned document"` and a suggestion to use OCR.

---

### 1.8 PDF with bookmarks

**Input:** A PDF with a two-level bookmark tree: top-level entries "Part One", "Part Two"; each containing sub-entries.

**Expected:** 2 sections, one per top-level bookmark. Sub-bookmark entries merged into the containing section's text. Section titles = bookmark titles.

---

### 1.9 Title/author detection — epub
**Input:** An epub with Dublin Core metadata `<dc:title>Pride and Prejudice</dc:title>` and `<dc:creator>Jane Austen</dc:creator>`.
**Expected:** `detect_title_author(path)` → `("Pride and Prejudice", "Jane Austen")`

### 1.10 Title/author detection — plain text (Project Gutenberg format)
**Input:** Text starting with `Title: Wuthering Heights` and `Author: Emily Brontë` within the first 300 lines.
**Expected:** `("Wuthering Heights", "Emily Brontë")`

### 1.11 Title/author detection — markdown heading + "by" line
**Input:**
```
# The Great Experiment

by Dr. Sarah Collins
```
**Expected:** `("The Great Experiment", "Dr. Sarah Collins")`

---

## 2. JSON Extraction from LLM Responses

These test `_extract_json()` in `llm_client.py`. Critical because local models frequently wrap JSON in prose or code fences.

### 2.1 Clean JSON (Anthropic typical output)
**Input:** `'{"summary": "Short summary.", "flashcards": []}'`
**Expected:** `{"summary": "Short summary.", "flashcards": []}`

### 2.2 JSON in markdown code fence
**Input:**
```
Sure! Here's the JSON:

```json
{"flashcards": [{"type": "basic", "front": "Q", "back": "A"}]}
```
```
**Expected:** `{"flashcards": [{"type": "basic", "front": "Q", "back": "A"}]}`

### 2.3 JSON preceded by prose
**Input:** `'Here you go:\n{"summary": "x"}\nHope that helps!'`
**Expected:** `{"summary": "x"}`

### 2.4 `<think>` block stripping (Qwen3 / reasoning models)
**Input:** `'<think>Let me think about this...</think>\n{"summary": "result"}'`
**Expected:** `{"summary": "result"}`

### 2.5 Balanced-brace extraction (stray trailing `}`)
**Input:** `'{"summary": "ok"}}'`  _(extra closing brace)_
**Expected:** `{"summary": "ok"}` _(stops at the balanced close)_

### 2.6 No valid JSON
**Input:** `"Sorry, I can't help with that."`
**Expected:** Raises `json.JSONDecodeError`

---

## 3. Flashcard Data Model

### 3.1 Default card type
```python
card = Flashcard(front="Q", back="A")
assert card.card_type == "basic"
assert card.is_cloze == False
```

### 3.2 Cloze flag
```python
card = Flashcard(front="Mitochondria are the {{c1::powerhouse}} of the cell.", back="", card_type="cloze")
assert card.is_cloze == True
```

---

## 4. CSV Export

### 4.1 Basic CSV — cloze cards excluded
**Input:** 1 basic card + 1 cloze card in a section.
**Expected:** CSV file has exactly 1 row. Row contains the basic card's front/back. No `{{c` markup in any cell.

### 4.2 Cloze CSV — basic cards excluded
**Input:** Same fixture.
**Expected:** CSV file has exactly 1 row. Row contains the cloze card's front (with `{{c1::...}}`).

### 4.3 Tags format
**Input:** `book_title="My Book"`, section `title="Chapter 1: The Storm"`
**Expected tag:** `"My_Book::Chapter_1:_The_Storm"` (spaces → underscores)

### 4.4 Section with zero flashcards
**Input:** Section with `flashcards=[]`
**Expected:** Neither CSV file gains any rows for this section. No error.

### 4.5 Multi-deletion cloze card
**Input:** `Flashcard(front="Founded in {{c1::1949}} by {{c2::twelve}} nations.", back="", card_type="cloze")`
**Expected in cloze CSV:** `text` column = `"Founded in {{c1::1949}} by {{c2::twelve}} nations."`, `back_extra` = `""`.

---

## 5. Markdown Export

### 5.1 Basic card rendering
**Input:** `Flashcard(front="How deep is the Dead Sea?", back="304 meters", card_type="basic")`
**Expected in output:**
```
- **Q:** How deep is the Dead Sea?
  **A:** 304 meters
```

### 5.2 Cloze card rendering
**Input:** `Flashcard(front="The Dead Sea sits {{c1::430}} m below sea level.", back="Lowest land elevation on Earth.", card_type="cloze")`
**Expected:** Cloze section header present, `{{c1::430}}` preserved verbatim, `*Lowest land elevation on Earth.*` present.

### 5.3 Cloze card with empty back
**Input:** `Flashcard(front="...{{c1::1949}}...", back="", card_type="cloze")`
**Expected:** No stray italic line after the cloze sentence.

### 5.4 Section with no cards — no "Flashcards:" header
**Input:** `SectionResult(title="Table of Contents", flashcards=[])`
**Expected:** The section heading appears, but the output for that section contains no `**Flashcards:**` or `Cloze cards` text.

### 5.5 Single-model attribution
**Input:** All sections have `model_used="claude-sonnet-4-6 (Anthropic API)"`
**Expected:** Output contains `_Generated with: claude-sonnet-4-6 (Anthropic API)_` immediately after the book title. No per-section model line.

### 5.6 Mixed-model attribution
**Input:** Section 1 has `model_used="claude-sonnet-4-6 (Anthropic API)"`, Section 2 has `model_used="llama3.1:8b (Ollama)"`
**Expected:** Header line `_Generated with multiple models: claude-sonnet-4-6 (Anthropic API), llama3.1:8b (Ollama)_`. Each section has its own `_Model: ..._` line.

---

## 6. Word (.docx) Export

### 6.1 Document structure
**Input:** 2-section result with character list.
**Expected paragraphs (in order):** Book title (Heading 0), model attribution (italic), "Main Characters" (Heading 1), character name (bold), character summary, section heading (Heading 1), summary, flashcard label (bold), Q/A bullet pairs, cloze label (bold), cloze sentence bullet, cloze extra (italic).

### 6.2 Bold/italic runs
**Input:** Basic card with `front="Q?"` and `back="A."`. Cloze card with `back="Extra."`
**Expected:** `"A: "` appears as a bold run. `"Extra."` appears as an italic run.

### 6.3 No flashcard heading for empty section
**Input:** Section with `flashcards=[]`
**Expected:** The paragraphs immediately following that section's heading do not include the text `"Flashcards:"` or `"Cloze cards:"`.

---

## 7. ChapterContinuityTracker

### 7.1 Non-part title — returns nothing, resets
```python
tracker = ChapterContinuityTracker()
fronts, questions = tracker.context_for("Chapter 5")
assert fronts is None and questions is None
```

### 7.2 First part of a split chapter — nothing to carry yet
```python
fronts, questions = tracker.context_for("Chapter 5 (part 1 of 3)")
assert fronts is None and questions is None
```

### 7.3 Later part receives earlier parts' output (cumulative)
```python
tracker.context_for("Chapter 5 (part 1 of 3)")
tracker.record("Chapter 5 (part 1 of 3)", ["Card A", "Card B"], ["Q1"])
tracker.context_for("Chapter 5 (part 2 of 3)")
tracker.record("Chapter 5 (part 2 of 3)", ["Card C"], [])
fronts, questions = tracker.context_for("Chapter 5 (part 3 of 3)")
assert fronts == ["Card A", "Card B", "Card C"]
assert questions == ["Q1"]
```

### 7.4 Resets at chapter boundary
```python
# After chapter 5 parts 1+2 recorded...
fronts, questions = tracker.context_for("Chapter 6 (part 1 of 2)")
assert fronts is None and questions is None
```

### 7.5 Returns independent copies (mutation safety)
```python
fronts, _ = tracker.context_for("Chapter 1 (part 2 of 2)")
fronts.append("Tampered")
# tracker's internal list must not be corrupted
```

---

## 8. Cost Estimation

### 8.1 Empty selection
**Input:** `section_char_counts=[]`, any combination of wants
**Expected:** `CostEstimate(input_tokens=0, output_tokens=0)`

### 8.2 No content requested
**Input:** `section_char_counts=[5000]`, all `want_*=False` (except `want_character_list` — which can't run alone)
**Expected:** `CostEstimate(input_tokens=0, output_tokens=0)`

### 8.3 Rolling context — only bumps non-first sections
**Input:** `[5000, 5000, 5000]`, `want_context_digest=True`
**Expected:** 2 extra bumps of `_CONTEXT_DIGEST_INPUT_TOKENS` (≈110 tokens each) vs. same config without context digest. No output token change.

### 8.4 Chapter continuity — additive with context digest
**Input:** `[5000, 5000]`, both `want_context_digest=True` and `want_chapter_continuity=True`
**Expected:** 1 non-first section gets both bumps (`_CONTEXT_DIGEST_INPUT_TOKENS + _CHAPTER_CONTINUITY_INPUT_TOKENS`). No output token change.

### 8.5 Character list — adds one consolidation block
**Input:** `[5000, 5000]`, `want_character_list=True`
**Expected:** Additional `2 * 120 + 300` input tokens and `4096` output tokens on top of the per-section totals.

---

## 9. Generation — Resume Logic

### 9.1 Skip sections with existing successful results
**Setup:** 3 sections checked; section 0 has a successful result, sections 1 and 2 do not.
**Expected:** `to_process = [1, 2]`. Only 2 API calls made. Section 0's result unchanged.

### 9.2 All sections already done — no calls made
**Setup:** All checked sections have successful results.
**Expected:** Status message set; `to_process = []`; no API calls; generation does not start.

### 9.3 Reconstruct initial context from prior results
**Setup:** Sections 0 and 1 done with `context_digest` values; section 2 failed. Resume.
**Expected:** The `initial_context` seed for the resumed worker = section 1's `context_digest` (the last successful digest in index order).

### 9.4 Reconstruct initial character notes from prior results
**Setup:** Sections 0 and 1 done with non-empty `character_notes`; section 2 failed.
**Expected:** `initial_notes` for the resumed worker contains the section-title/notes pairs from sections 0 and 1, in index order.

---

## 10. Groq Rate Limit Handling

### 10.1 Retry on 429 with Retry-After ≤ 120s
**Input:** First call returns HTTP 429 with `Retry-After: 30`. Second call succeeds.
**Expected:** One `time.sleep(30)` call; result returned from second attempt.

### 10.2 Raise immediately on Retry-After > 120s
**Input:** HTTP 429 with `Retry-After: 845`.
**Expected:** `RuntimeError` raised immediately (no sleep). Message mentions "quota exceeded" and `console.groq.com`.

### 10.3 HTTP 413 — clear error message
**Input:** HTTP 413 response.
**Expected:** `RuntimeError` with message mentioning "too large" and suggesting reducing `Max chars/section` or switching models.
