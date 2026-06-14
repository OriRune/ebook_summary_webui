# Architecture

## Module Map (Desktop)

```
ebook_flashcards/
├── parser.py       — File ingestion + section splitting
├── llm_client.py   — LLM backends, prompt building, response parsing
├── exporter.py     — CSV, Markdown, Word export
├── config.py       — API key + preference persistence
└── main.py         — Tkinter GUI, orchestration, worker thread
```

---

## Data Flow

```
File on disk
    │
    ▼
parser.split_ebook(path, max_chars)
    │  Handles .epub, .txt, .md, .pdf
    │  Detects headings → splits on them
    │  Falls back to paragraph chunks
    │  Subdivides oversized sections → "(part N of M)" titles
    ▼
list[Section]   ←──── stored in GUI memory
    │
    │  User selects sections, sets options, clicks Generate
    ▼
[Background worker thread]
    │
    │  For each section (sequential, not parallel):
    │  ├─ ChapterContinuityTracker.context_for(title)
    │  │       → prior_chapter_flashcard_fronts, prior_chapter_discussion_questions
    │  ├─ llm_client.generate_section_content(...)
    │  │       → SectionResult (summary, flashcards, discussion, char_notes, context_digest)
    │  └─ ChapterContinuityTracker.record(title, fronts, questions)
    │
    │  [If character list requested, after all sections:]
    │  └─ llm_client.consolidate_character_list(...)
    │          → list[CharacterSummary]
    │
    ▼
Results stored in dict[int, SectionResult]
    │
    ▼
exporter.*()
    ├─ export_flashcards_csv()         → basic_flashcards.csv
    ├─ export_cloze_flashcards_csv()   → cloze_flashcards.csv
    ├─ export_summaries_markdown()     → study_guide.md
    └─ export_summaries_docx()         → study_guide.docx
```

---

## LLM Backend Dispatch

All three backends share the same system prompt and user message text (built by `_build_system_prompt` and `_build_user_message`). The dispatch happens in `generate_section_content`:

```
backend == "anthropic"  →  anthropic.Anthropic(api_key).messages.create(...)
backend == "ollama"     →  HTTP POST http://localhost:11434/v1/chat/completions
backend == "groq"       →  HTTP POST https://api.groq.com/openai/v1/chat/completions
                              (with retry loop for 429)
```

Both Ollama and Groq use the OpenAI-compatible chat completions API format.

---

## Prompt Assembly

```
_build_system_prompt(include_summary, include_flashcards, include_discussion,
                     content_type, include_character_notes, include_context_digest,
                     include_chapter_continuity)
    │
    ├── genre intro block (fiction / nonfiction / auto-detect)
    ├── [if summary]       _SUMMARY_INSTRUCTION
    ├── [if flashcards]    _FLASHCARD_INSTRUCTIONS  (long; includes cloze syntax)
    ├── [if discussion]    _DISCUSSION_INSTRUCTIONS
    ├── [if char notes]    _CHARACTER_NOTES_INSTRUCTION
    ├── [if context]       _ROLLING_DIGEST_INSTRUCTION
    ├── [if continuity]    _CHAPTER_CONTINUITY_INSTRUCTION
    └── "Respond with ONLY a JSON object..." + JSON shape
```

```
_build_user_message(section_title, section_text,
                    prior_context, prior_chapter_flashcard_fronts,
                    prior_chapter_discussion_questions)
    │
    ├── [if prior_context]   "Recap of the story so far..." block
    ├── [if chapter fronts/questions]  "Already produced for EARLIER PARTS..." block
    └── "Section title: {title}\n\nSection text:\n{text}"
```

All blocks separated by `\n\n---\n\n`.

---

## JSON Response Parsing

`_extract_json(raw)` tries four strategies in order:
1. Direct `json.loads()` (Claude's typical output)
2. Regex for ` ```json ... ``` ` code fence
3. Greedy `{.*}` regex (catches "Here is the JSON: {...}" prose wrappers)
4. Balanced-brace scan (handles stray trailing `}` after the real object)

Pre-processing: strips `<think>...</think>` blocks (Qwen3 and similar models).

---

## Section Subdivision

The `PART_RE = re.compile(r'^(.*) \(part (\d+) of (\d+)\)$')` pattern is the canonical marker used across the codebase to recognize split-chapter sections:

- `parser.py`: appends the suffix when subdividing oversized sections
- `llm_client.py / ChapterContinuityTracker`: matches the suffix to group parts
- `main.py`: uses it when renumbering after manual merges

---

## Worker Thread Communication

The GUI runs generation on a daemon thread. Results are posted to a `queue.Queue` and polled by the main thread on a 100ms timer (`after(100, _poll_queue)`):

| Message kind | Payload | GUI action |
|---|---|---|
| `"result"` | `(section_idx, SectionResult)` | Store result, update status icon, update result pane |
| `"character_list_started"` | `None` | Update progress label |
| `"character_list"` | `(list[CharacterSummary], error)` | Store character list, render Characters tab |
| `"done"` | `elapsed_seconds` | Freeze timer, re-enable buttons |
| `"stopped"` | `elapsed_seconds` | Same as done |

---

## Config Persistence

```
~/.ebook_flashcards/config.json    (permissions: 0600)
{
  "anthropic_api_key": "sk-ant-...",
  "groq_api_key":      "gsk_...",
  "dark_mode":         false
}
```

The file is read/written as a whole dict on every load/save operation. All helper functions (`load_api_key`, `save_api_key`, etc.) go through the shared `_load_config` / `_save_config` pair, ensuring keys are never lost when saving one value.
