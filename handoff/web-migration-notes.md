# Web Migration Notes

Decisions, trade-offs, and things to watch out for when rebuilding this as a web app.

---

## What Ports Cleanly

These modules can be lifted nearly as-is into a web backend (Python/FastAPI, Django, etc.):

- **`parser.py`** — Pure Python, no GUI dependencies. Works exactly as-is server-side. The only change needed: accept a file path or a file-like object from the upload handler.
- **`llm_client.py`** — Pure Python, no GUI dependencies. All three backends (`anthropic`, `ollama`, `groq`) work server-side. `ChapterContinuityTracker` is stateless across requests (it's a per-run object) — just instantiate it per generation run.
- **`exporter.py`** — Pure Python. Works server-side; just write to a temp file and serve it as a download, or return the content directly.
- **All prompts** — Verbatim from `prompts.md`. No changes required.
- **All data structures** — `Flashcard`, `CharacterNote`, `CharacterSummary`, `SectionResult`, `CostEstimate` map directly to Pydantic models or TypeScript types.

---

## File Upload

**Desktop:** User picks a local file from a native dialog; the app reads it directly from disk.

**Web equivalent:**
- Frontend: file input (`<input type="file">`) or drag-and-drop
- Backend: receive the upload, write to a temp file, pass the temp path to `split_ebook()`
- Supported MIME types: `application/epub+zip`, `text/plain`, `text/markdown`, `application/pdf`
- Size limit: set a reasonable cap (e.g. 50 MB); most ebooks are under 5 MB; PDFs can be larger

**Security note:** Never pass user-controlled filenames to the filesystem directly. Use `tempfile.NamedTemporaryFile` with the correct suffix derived from the MIME type.

---

## Long-Running Generation — Streaming vs. Polling

**Desktop:** Runs on a background thread, posts events to a queue, polled by the GUI every 100ms.

**Web equivalent options:**

### Option A: Server-Sent Events (SSE) — Recommended
The backend streams section results to the frontend as they complete. Each event is a JSON blob of one `SectionResult`. The frontend updates the UI progressively.
- Natural fit for the sequential "one section at a time" pattern
- No long-poll timeout issues
- Easy to implement with FastAPI's `StreamingResponse` or Django Channels

### Option B: WebSocket
Bidirectional — useful if you also want the user to be able to send a "stop" signal mid-run.

### Option C: Task queue + polling (Celery / Redis)
Submit the job, get a task ID back, poll `/jobs/{id}/status` every few seconds. More complex, but better for very long books (> 10 minutes) where SSE connections can time out.

**Recommended approach:** SSE for the normal case; add a `DELETE /jobs/{id}` endpoint to handle the "Stop" button.

---

## API Key Handling

**Desktop:** Keys stored locally in `~/.ebook_flashcards/config.json` with 0600 permissions.

**Web equivalent — several models:**

### User-supplied keys (bring-your-own-key)
- User enters their API key in the browser; sent over HTTPS with each generation request
- Never store in `localStorage` — too exposed
- Options: (a) keep in session-only cookie; (b) encrypt and store server-side per account; (c) send with every request and never store server-side (simplest, but user must re-enter each session)
- Good for a free/open-source tool where you don't want to absorb API costs

### Server-side key (you pay, user doesn't enter keys)
- You hold one Anthropic/Groq key server-side
- Add usage limits, quotas, or billing per user
- Simpler UX; higher operational cost and complexity

### Hybrid
- Default: user supplies their own key
- Premium: server-side key for users who pay

---

## Session / State Management

**Desktop:** Everything is in-memory for the duration of the app session.

**Web equivalent:**

| Desktop state | Web equivalent |
|---|---|
| `list[Section]` | Server-side session or DB, keyed by upload/session ID |
| `dict[int, SectionResult]` | DB table or Redis hash, keyed by (session_id, section_idx) |
| `list[CharacterSummary]` | Stored with the session/run |
| Generation in progress flag | Run status in DB/Redis |
| Config (API keys, dark mode) | Server-side (keys) + browser localStorage (dark mode, non-sensitive prefs) |

**Minimal approach for an MVP:** Use server-side session storage (e.g. Flask-Session with filesystem or Redis backend). No database needed initially. Expire sessions after 24h.

---

## Export Downloads

**Desktop:** Writes files to user-chosen paths via native save dialog.

**Web equivalent:**
- Generate the file in a server-side temp directory
- Serve as a download with `Content-Disposition: attachment; filename="..."`
- For CSV: return directly as response body
- For Markdown: return directly
- For .docx: write to BytesIO buffer with python-docx, return as response

---

## Ollama Backend

**Desktop:** Hits `http://localhost:11434` — the user's own local Ollama instance.

**Web equivalent:**
- Localhost Ollama is not accessible from a server — this backend only makes sense if:
  - The web app is meant to be run locally (e.g. a Docker Compose setup the user runs themselves)
  - OR you provide a server-hosted Ollama instance (GPU server)
- For a publicly hosted web app, Ollama support is likely N/A unless users self-host
- Recommend: keep the backend code as-is, but disable the Ollama UI option when the app is running in "cloud mode"

---

## Cost Estimation

The `estimate_run_cost()` function is pure arithmetic — no API calls. Port it as-is. Call it from the frontend via a lightweight API endpoint that accepts section char counts and option flags, and returns the estimate. Or compute it entirely client-side if you replicate the constants in JavaScript.

---

## Dark Mode

**Desktop:** Tkinter theme switched globally; preference saved to config.json.

**Web equivalent:** Standard CSS approach:
- Use a `data-theme` attribute on `<html>` or CSS custom properties
- Toggle with a button; persist to `localStorage`
- Alternatively, respect `prefers-color-scheme` by default and allow override

---

## Section Operations

These are all in-memory operations in the desktop app. In the web app they require server-side state:

- **Rename section:** PATCH endpoint updating the title in the session store
- **Merge sections:** POST endpoint; server merges the text and recalculates titles (including "(part N of M)" renumbering)
- **Clear result:** DELETE endpoint for a single section result
- **Clear all results:** DELETE endpoint for all results in a session
- **Check/uncheck sections:** Can be purely client-side state until Generate is clicked, then send the list of checked indices with the generation request

---

## Max Chars / Section Setting

**Desktop:** Applied at parse time; changing it requires re-opening the file.

**Web equivalent:** Include as a parameter in the upload/parse request. If the user changes it after upload, re-parse server-side (the original file bytes should still be in the session) and return the new section list.

---

## Dependencies to Install Server-Side

```
anthropic          # Anthropic API SDK
pypdf              # PDF text extraction
ebooklib           # EPUB parsing
beautifulsoup4     # HTML extraction (used by ebooklib path)
python-docx        # Word document export
```

Groq and Ollama use plain `urllib` — no extra packages needed.

---

## Things That Don't Exist in the Web Version

- Native file picker dialog → replaced by `<input type="file">`
- Background thread → replaced by async/SSE/task queue
- Tkinter widgets → replaced by frontend UI (React, Svelte, plain HTML, etc.)
- Local config file → replaced by server-side session/DB + browser storage
- In-memory result dict → replaced by server-side persistence

---

## Suggested Tech Stack (Opinions)

**Backend:** FastAPI (Python) — async-native, SSE support, Pydantic models slot in cleanly, easy to add auth later.

**Frontend:** Either React + TypeScript or plain HTML/JS with HTMX depending on desired interactivity level. The app is relatively simple (no real-time collaboration, no complex state machine) so HTMX could work surprisingly well.

**Storage:** Start with server-side filesystem sessions (no DB setup). Add PostgreSQL if you need persistence across server restarts or multi-user support.

**Deployment:** A single VPS with nginx in front is sufficient for low-to-moderate traffic. The heavy lifting is done by the LLM APIs, not your server.
