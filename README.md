# Ebook → Summaries & Flashcards

Turn an ebook into study aids — concise **summaries**, Anki-ready **flashcards**
(basic + cloze), **discussion questions**, a full-book **character guide**, and a
rolling **story-context** digest — powered by the LLM provider of your choice.

Built with **Next.js (App Router) + TypeScript + React + Tailwind CSS**. LLM calls and
file parsing happen server-side in API routes; your API key is **bring-your-own**, stored
only in your browser and sent per request — never persisted on the server.

---

## Features

- **Inputs:** `.epub`, `.pdf`, `.txt`, `.md` — auto-split into chapters/sections, with
  title/author detection. Scanned (image-only) PDFs are rejected with a clear message.
- **LLM backends:** Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, and (optional,
  local) Ollama. Bring your own key — OpenRouter alone unlocks models from many providers.
- **Per-section study aids:** summary, flashcards (atomic Q&A + cloze), discussion
  questions, character notes, and an optional carry-forward story recap.
- **Section tools:** check/uncheck, rename, merge, adjust *Max chars/section* + re-split.
- **Streaming generation** with live progress; **Stop** anytime; re-running **resumes**
  only the unfinished/failed sections.
- **Exports:** Anki CSV (Basic + Cloze), Markdown study guide, Word `.docx`, and raw
  character/context notes.
- **Light/dark themes**, responsive desktop + mobile layout, and run state persisted
  locally (a refresh won't lose your work).

---

## Run it locally

You'll need **Node.js 18+** (20 or 22 recommended) and **Git**.

**1. Open a terminal**
- **Windows:** Command Prompt, PowerShell, or Windows Terminal
- **macOS:** the Terminal app (press <kbd>⌘</kbd> <kbd>Space</kbd>, type "Terminal")
- **Linux:** your terminal emulator

**2. Clone the repo and enter it**
```bash
git clone https://github.com/OriRune/ebook_summary_webui.git
cd ebook_summary_webui
```

**3. Install dependencies** (same on every OS)
```bash
npm install
```

**4. Start the app**
```bash
npm run dev
```
Then open <http://localhost:3000>. For a production build instead:
```bash
npm run build
npm run start
```

**5. Add your API key** in **Settings** (top of the page), pick a backend, and open an
ebook. The key lives only in your browser.

---

## Configuration (optional)

Environment variables are only needed for **Ollama** (local models). Create a
`.env.local` from the example, then edit it:

| OS | Command |
| --- | --- |
| Windows · PowerShell | `Copy-Item .env.example .env.local` |
| Windows · Command Prompt | `copy .env.example .env.local` |
| macOS / Linux | `cp .env.example .env.local` |

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_ALLOW_OLLAMA` | `false` | Set to `true` to show the Ollama backend and let the server reach a local Ollama instance. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where the server talks to Ollama. |

You'll also need Ollama running — install it from <https://ollama.com>. The hosted
providers (Anthropic, OpenAI, Gemini, OpenRouter, Groq) need no env config; just paste
your key in the UI. Get a key from each provider's console:

| Provider | Get a key |
| --- | --- |
| Anthropic | <https://console.anthropic.com/settings/keys> |
| OpenAI | <https://platform.openai.com/api-keys> |
| Google Gemini | <https://aistudio.google.com/apikey> |
| OpenRouter | <https://openrouter.ai/keys> |
| Groq | <https://console.groq.com/keys> |

> **Don't have Node.js?** Install it from <https://nodejs.org> (Windows/macOS installers),
> via Homebrew on macOS (`brew install node`), or your package manager / [nvm](https://github.com/nvm-sh/nvm)
> on Linux, then re-open your terminal.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (hot reload) on port 3000. |
| `npm run build` | Production build. |
| `npm run start` | Serve the production build. |
| `npm test` | Run the Vitest suite. |
| `npm run typecheck` | Type-check with `tsc --noEmit`. |

---

## Project structure

```
src/
├── app/
│   ├── page.tsx            # single-page UI (controls + workspace + How-to tab)
│   ├── layout.tsx, globals.css
│   └── api/                # parse · generate (SSE) · models · export
├── components/             # SettingsPanel, GenerateOptions, SectionList,
│                           #   ResultTabs, ExportBar, HowToUse
├── hooks/useSettings.ts    # localStorage settings (keys, model, dark mode)
└── lib/
    ├── parser/             # epub / pdf / txt-md splitting + title/author
    ├── llm/                # prompts, backends, generate, consolidate, cost
    └── export/             # csv, markdown, docx, notes
tests/                      # Vitest (parser, JSON extraction, exports, cost, …)
```

---

## Privacy & cost

- **Bring-your-own-key:** API keys are stored in your browser's local storage and sent
  with each request to the provider; they are never stored on the server.
- The in-app cost estimate is a rough, per-provider ballpark; actual usage varies with
  the book and the model's responses. Gateways like OpenRouter (and Groq) show "varies by
  model" instead of a dollar figure; Ollama is free/local.

---

## Deploying

The easiest path is **Vercel**: import the repo and deploy (no env vars needed unless you
want Ollama, which can't reach a local instance from the cloud anyway). Two hosted limits to
know about:

- **Uploads up to ~4 MB** (Vercel's serverless request-body limit). Larger books: run locally.
- **A per-request time limit** (60s Hobby / up to 300s Pro). Long books may not finish in one
  pass — completed sections are saved as they stream, so just click **Generate** again to
  resume the rest. Self-host on a long-lived Node server for no time limit.

## License

[MIT](./LICENSE) © 2026 OriRune.
