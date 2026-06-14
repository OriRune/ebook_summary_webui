# Data Model

All core data structures from the Python source, annotated for use in a web rebuild. Python dataclasses map directly to JSON schemas; the web app should treat these as the canonical contracts between frontend, backend, and LLM layer.

---

## Parser Layer (`parser.py`)

### `Section`
One chapter or chunk of the ebook, sized to fit an LLM context window.

```python
@dataclass
class Section:
    title: str    # Chapter/section heading detected from the file
    text:  str    # Raw text content of the section

    # Derived (not stored):
    char_count: int   # len(text)
    word_count: int   # len(text.split())
```

**JSON equivalent:**
```json
{
  "title": "Chapter 3: The Storm",
  "text":  "The rain began at midnight..."
}
```

**Section title patterns produced by the parser:**
- From epub headings: verbatim heading text, e.g. `"Chapter III"`
- From PDF bookmarks: verbatim bookmark title
- From heading regex: the matched line stripped of `#` characters
- Paragraph-chunk fallback: `"Part 1"`, `"Part 2"`, …
- Subdivided oversized sections: `"{original title} (part N of M)"` — the `PART_RE` pattern `^(.*) \(part (\d+) of (\d+)\)$` is used across the codebase to recognize these

---

## LLM Layer (`llm_client.py`)

### `Flashcard`
```python
@dataclass
class Flashcard:
    front:     str          # Question, prompt, or cloze sentence (with {{c1::...}} markup)
    back:      str          # Answer, or extra context for a cloze card (may be empty)
    card_type: str = "basic"  # "basic" | "cloze"

    # Derived:
    is_cloze: bool          # card_type == "cloze"
```

**Cloze syntax:** Anki's standard `{{c1::answer}}` notation. Multiple deletions in one card use `{{c2::...}}`, `{{c3::...}}`, etc. The `front` field holds the full sentence with markup; `back` holds optional extra context (shown after the answer is revealed).

**JSON from LLM:**
```json
{ "type": "basic", "front": "How deep is the Dead Sea?", "back": "304 meters" }
{ "type": "cloze", "front": "The Dead Sea sits {{c1::430}} m below sea level.", "back": "Lowest land elevation on Earth." }
```

### `CharacterNote`
Raw, section-scoped observation gathered during generation. Input to the consolidation call; not shown directly to users.

```python
@dataclass
class CharacterNote:
    name: str   # Character's name as the LLM identified it
    note: str   # 1-2 sentence observation from this specific section
```

**JSON from LLM:**
```json
{ "name": "Elizabeth Bennet", "note": "Refuses Darcy's first proposal, revealing her prejudice against him." }
```

### `CharacterSummary`
Finished, full-book character entry from the consolidation call. Shown to the user in the Characters tab and included in exports.

```python
@dataclass
class CharacterSummary:
    name:    str   # Canonical name (merged across name variants by the LLM)
    summary: str   # 3-6 sentence full-book paragraph
```

**JSON from LLM:**
```json
{ "name": "Elizabeth Bennet", "summary": "The second Bennet daughter and protagonist..." }
```

### `SectionResult`
The complete output for one section call. Stored in memory keyed by section index.

```python
@dataclass
class SectionResult:
    title:                str
    summary:              str                      # Empty string if not requested or on error
    flashcards:           list[Flashcard]          # Empty list if not requested or on error
    discussion_questions: list[str]                # Empty list if not requested or on error
    character_notes:      list[CharacterNote]      # Empty list if not requested
    context_digest:       str                      # Empty string if not requested
    error:                str | None               # Set on any failure; other fields empty/default
    model_used:           str                      # E.g. "claude-sonnet-4-6 (Anthropic API)"
```

**In-memory store (desktop app):** `dict[int, SectionResult]` keyed by section index.

**Web equivalent:** Store in a database table or session object. Suggested schema:

```sql
CREATE TABLE section_results (
    run_id       TEXT NOT NULL,
    section_idx  INTEGER NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    flashcards   JSONB NOT NULL DEFAULT '[]',
    discussion   JSONB NOT NULL DEFAULT '[]',
    char_notes   JSONB NOT NULL DEFAULT '[]',
    context_dig  TEXT NOT NULL DEFAULT '',
    error        TEXT,
    model_used   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, section_idx)
);
```

### `CostEstimate`
```python
@dataclass
class CostEstimate:
    input_tokens:  int
    output_tokens: int

    # Derived:
    total_tokens: int    # input + output
    usd: float           # computed from token counts × per-token prices
```

---

## Config (`config.py`)

Stored at `~/.ebook_flashcards/config.json` (desktop). For a web app, store per-user server-side (never in browser storage for API keys).

```json
{
  "anthropic_api_key": "sk-ant-...",
  "groq_api_key":      "gsk_...",
  "dark_mode":         false
}
```

**Web app notes:**
- API keys should be stored encrypted at rest, scoped to the user's session/account
- Dark mode becomes a browser preference (localStorage or user profile)
- Consider allowing users to use their own API keys OR a server-side key (with usage limits/billing)

---

## LLM Request / Response Contracts

### Section generation — system prompt shape
The system prompt is assembled from modular instruction blocks depending on which outputs are requested. The JSON shape the LLM is instructed to return:

```json
{
  "summary":              "string (if requested)",
  "flashcards":           [{"type": "basic|cloze", "front": "...", "back": "..."}],
  "discussion_questions": ["string", "..."],
  "character_notes":      [{"name": "...", "note": "..."}],
  "context_digest":       "string (if requested)"
}
```

All fields are optional in the sense that only requested fields appear in the prompt's expected JSON shape — the LLM is shown only the fields it should produce.

### Section generation — user message shape
```
[Optional: recap of story so far (prior_context)]

---

[Optional: already-covered flashcards and discussion questions from earlier parts of this chapter]

---

Section title: {title}

Section text:
{text}
```

### Character consolidation — system prompt
Fixed prompt (see `_CHARACTER_LIST_SYSTEM_PROMPT` in `llm_client.py`). Instructs the model to merge per-section notes, identify 8-15 main figures, and write one paragraph each.

**Expected JSON response:**
```json
{
  "characters": [
    {"name": "...", "summary": "..."},
    ...
  ]
}
```

### Character consolidation — user message shape
```
Section-by-section character notes:

Section: {title}
- {name}: {note}
- {name}: {note}

Section: {title}
- {name}: {note}
...
```

---

## Export File Formats

### Basic flashcard CSV
```
front,back,tags
"How deep is the Dead Sea?","304 meters","Book_Title::Chapter_1"
```
Columns: front, back, tags. No header row. Tags use `::` as separator; spaces replaced with `_`.

### Cloze flashcard CSV
```
text,back_extra,tags
"The Dead Sea sits {{c1::430}} m below sea level.","Lowest land elevation on Earth.","Book_Title::Chapter_1"
```
Columns: text (cloze sentence), back_extra (optional), tags. No header row.

### Markdown study guide — structure
```markdown
# {Book Title} — Study Guide

_Generated with: {model} ({backend})_

## Main Characters

**{Name}**
{summary paragraph}

## {Section Title}

_Model: {model}_ (only if multiple models used)

{summary paragraph}

**Flashcards:**

- **Q:** {front}
  **A:** {back}

**Cloze cards** (Anki fill-in-the-blank style...):

- {cloze sentence}
  *{extra context}*

**Discussion questions:**

- {question}
```

### Word document (.docx) — equivalent structure
Same logical structure using python-docx styles:
- `Heading 0` for the book title
- Italic paragraph for model attribution
- `Heading 1` for character guide section and each section title
- Bold paragraph label for "Flashcards:", "Cloze cards:", "Discussion questions:"
- `List Bullet` style for individual cards and questions

---

## ChapterContinuityTracker — State

```python
class ChapterContinuityTracker:
    _base_title:          str | None   # Title base of the chapter currently being tracked
    _flashcard_fronts:    list[str]    # Accumulated card fronts from earlier parts
    _discussion_questions: list[str]  # Accumulated questions from earlier parts
```

**Reset conditions:** Resets to empty whenever a non-part section title is encountered, or a part title from a different chapter base is encountered.

**Lifecycle:** One instance per Generate run, instantiated in the worker thread and discarded at run end.

---

## In-Memory Run State (desktop; web equivalent in parentheses)

| Field | Type | Web equivalent |
|---|---|---|
| `sections` | `list[Section]` | DB table or server-side session |
| `section_checked` | `dict[int, bool]` | User selection sent per request |
| `results` | `dict[int, SectionResult]` | DB table keyed by (run_id, section_idx) |
| `character_list` | `list[CharacterSummary]` | DB table or attached to run record |
| `character_list_error` | `str \| None` | Stored alongside character_list |
| Anthropic API key | `str` (in-memory after save) | Server-side encrypted store |
| Groq API key | `str` (in-memory after save) | Server-side encrypted store |
| `_generating` | `bool` | Run status field in DB |
