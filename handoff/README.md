# Ebook Flashcard Generator — Handoff Package

This package contains everything needed to rebuild the desktop Python/Tkinter application as a web app from scratch. Start here.

---

## Contents

| File | What it covers |
|---|---|
| `source/` | All Python source files, verbatim |
| `spec.md` | Functional spec: every feature, user flow, input/output, and behaviour |
| `data-model.md` | All data structures, LLM JSON contracts, export formats, DB schema suggestions |
| `test-cases.md` | Concrete inputs with expected outputs for every major component |
| `architecture.md` | Module map, data flow, prompt assembly, thread/queue design |
| `prompts.md` | Every LLM prompt verbatim — system prompts, user messages, genre blocks |
| `web-migration-notes.md` | What ports cleanly, what needs rethinking, recommended tech stack |

---

## Source Files

| File | Role |
|---|---|
| `source/parser.py` | Ebook ingestion and section splitting (.epub, .txt, .md, .pdf) |
| `source/llm_client.py` | LLM backends (Anthropic, Ollama, Groq), prompt building, response parsing, cost estimation |
| `source/exporter.py` | CSV (basic + cloze), Markdown, and Word (.docx) export |
| `source/config.py` | API key and preference persistence |
| `source/main.py` | Tkinter GUI and orchestration (reference only — not ported) |
| `source/test_parser.py` | Smoke test for the parser (run: `python test_parser.py <file>`) |
| `source/test_flashcard_export.py` | Unit tests for flashcard data model and exporters |
| `source/test_chapter_continuity.py` | Unit tests for ChapterContinuityTracker and prompt/cost helpers |

---

## Suggested Reading Order

1. **`spec.md`** — understand what the app does before looking at code
2. **`data-model.md`** — understand the data structures you'll be working with
3. **`architecture.md`** — understand how the pieces connect
4. **`prompts.md`** — the LLM layer is the core; know the prompts verbatim
5. **`source/llm_client.py`** — the most important file; backend-agnostic generation logic
6. **`source/parser.py`** — ingestion and splitting; ports cleanly
7. **`source/exporter.py`** — export logic; ports cleanly
8. **`web-migration-notes.md`** — decisions to make before writing the first line of web code
9. **`test-cases.md`** — write these tests early; most are API-free and fast

---

## Key Design Decisions to Make First

Before writing any web code, settle on:

1. **API key model** — user-supplied (bring your own key) vs. server-side (you pay)? See `web-migration-notes.md §API Key Handling`.
2. **Generation streaming** — SSE is the recommended approach; decide before designing the frontend. See `web-migration-notes.md §Long-Running Generation`.
3. **Session storage** — filesystem sessions are fine for MVP; PostgreSQL if you need multi-user persistence.
4. **Ollama support** — only viable for a self-hosted/local-Docker deployment. Drop it or make it optional for a cloud-hosted app.
