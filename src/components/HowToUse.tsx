"use client";

import { ALLOW_OLLAMA } from "@/hooks/useSettings";

const REPO_URL = "https://github.com/OriRune/ebook_summary_webui";
const REPO_GIT = `${REPO_URL}.git`;

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-[var(--link)] underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

interface Step {
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Choose a backend & enter your API key",
    body: (
      <>
        In <strong>Setup</strong>, pick a backend — Anthropic, OpenAI, Google Gemini,
        OpenRouter, or Groq{ALLOW_OLLAMA ? ", or Ollama (local)" : ""} — and paste your
        API key (each provider links to where you get one). Your key is stored{" "}
        <strong>only in your browser</strong>, sent with each request, and never saved
        on our server. For every backend except Anthropic, hit <em>↺ Refresh</em> to
        load the model list. Not sure which model to use? Click a{" "}
        <strong>Suggested</strong> chip for a good pick (hover for the trade-off);
        ↺ Refresh always lists everything the provider offers. OpenRouter is a handy
        gateway: one key unlocks models from Anthropic, OpenAI, Google, Meta, and more.
      </>
    ),
  },
  {
    title: "Open an ebook",
    body: (
      <>
        Click <strong>Open ebook…</strong> and choose an <code>.epub</code>,{" "}
        <code>.pdf</code>, <code>.txt</code>, or <code>.md</code> file. It&apos;s split
        into sections automatically, and the title/author are filled in when they can
        be detected. (Scanned, image-only PDFs aren&apos;t supported — OCR them first.)
      </>
    ),
  },
  {
    title: "Review the sections",
    body: (
      <>
        Uncheck anything you want to skip (title pages, indexes, &ldquo;praise
        for&rdquo; pages). Double-click a title to <strong>rename</strong> it, use the
        ↑/↓ buttons to <strong>merge</strong> a section with a neighbor, and adjust{" "}
        <em>Max chars/section</em> then <strong>Re-split</strong> to change how finely
        the book is chunked — chapters split into evenly-sized parts, with no tiny
        leftover at the end. Drag the bottom-right corner of the Sections panel to{" "}
        <strong>resize</strong> it — wider for long titles, taller for more rows.
      </>
    ),
  },
  {
    title: "Pick what to generate",
    body: (
      <>
        Choose any of <strong>Summary</strong>, <strong>Flashcards</strong>, and{" "}
        <strong>Discussion questions</strong>. Set <em>Content</em> to Fiction or
        Nonfiction to enable the <strong>character guide</strong>. Optionally turn on{" "}
        <em>Carry story context forward</em> so each section gets a running recap of
        what came before.
      </>
    ),
  },
  {
    title: "Generate",
    body: (
      <>
        Click <strong>Generate for checked sections</strong>. Results stream in one
        section at a time with a live progress bar. Long books <strong>continue
        automatically</strong> across the host&apos;s per-request time limit — just leave
        the tab open until it&apos;s done; no repeated clicking. <strong>Stop</strong>{" "}
        halts after the current section, and clicking Generate again{" "}
        <strong>resumes</strong> — only unfinished or failed sections are re-processed.
      </>
    ),
  },
  {
    title: "Browse the results",
    body: (
      <>
        Select a section and switch between the <strong>Summary</strong>,{" "}
        <strong>Flashcards</strong>, <strong>Discussion</strong>,{" "}
        <strong>Section characters</strong>, <strong>Characters</strong>, and{" "}
        <strong>Section text</strong> tabs. <strong>Section characters</strong> shows
        the character notes gathered from just that section; the book-wide{" "}
        <strong>Characters</strong> guide merges them across the whole book — the rest
        are per section.
      </>
    ),
  },
  {
    title: "Export",
    body: (
      <>
        Download your study aids: <strong>Anki CSV</strong> (Basic and Cloze decks),
        a <strong>Markdown</strong> or <strong>Word (.docx)</strong> study guide, and
        the raw <strong>character</strong> / <strong>context</strong> notes. Buttons
        enable themselves once the matching content exists.
      </>
    ),
  },
];

export default function HowToUse() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="card border-l-4 border-l-[var(--coral)]">
        <h2 className="text-xl font-bold tracking-tight">How to use this site</h2>
        <p className="reading mt-2 text-muted">
          Turn any ebook into summaries, Anki flashcards, discussion questions, and a
          character guide — powered by the LLM provider of your choice. Here&apos;s the
          whole flow, start to finish.
        </p>
      </section>

      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={i} className="card flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--coral)] to-[var(--lavender)] font-bold text-white shadow-soft">
              {i + 1}
            </span>
            <div>
              <h3 className="font-semibold text-heading">{step.title}</h3>
              <p className="reading mt-1">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="callout reading space-y-2">
        <p>
          <strong>Good to know.</strong>
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            The cost estimate is a rough, per-provider ballpark; actual usage varies with
            the book and the model&apos;s responses. Gateways like OpenRouter (and Groq)
            show &ldquo;varies by model&rdquo; instead of a dollar figure; Ollama is
            free/local.
          </li>
          <li>
            Bring your own key — it lives in your browser&apos;s local storage only.
            Clear it anytime by emptying the field.
          </li>
          <li>
            Your sections and results are saved locally, so a refresh won&apos;t lose a
            run. Very large books take longer and cost more — start with a few sections
            to gauge output.
          </li>
        </ul>
      </div>

      <section className="card space-y-3 border-l-4 border-l-[var(--wisteria)]">
        <h2 className="text-lg font-bold tracking-tight">Prefer to run it yourself?</h2>
        <p className="reading">
          This tool is open source. If you&apos;d rather run it on your own computer than
          use the hosted site, grab the code from{" "}
          <Link href={REPO_URL}>GitHub</Link> and start it locally. You&apos;ll need{" "}
          <strong>Node.js 18+</strong> (20 or 22 recommended) and <strong>Git</strong>
          installed first.
        </p>

        <ol className="reading list-decimal space-y-3 pl-6 marker:font-semibold marker:text-heading">
          <li>
            <strong>Open a terminal.</strong> On <strong>Windows</strong>: Command
            Prompt, PowerShell, or Windows Terminal. On <strong>macOS</strong>: the
            Terminal app (press <code>⌘&nbsp;Space</code>, type &ldquo;Terminal&rdquo;).
            On <strong>Linux</strong>: your terminal emulator.
          </li>
          <li>
            <strong>Clone the repository and enter the folder:</strong>
            <Cmd>{`git clone ${REPO_GIT}\ncd ebook_summary_webui`}</Cmd>
          </li>
          <li>
            <strong>Install dependencies</strong> (same command on every OS):
            <Cmd>npm install</Cmd>
          </li>
          <li>
            <strong>Start the app:</strong>
            <Cmd>npm run dev</Cmd>
            then open <code>http://localhost:3000</code> in your browser. For a faster,
            production build instead, run <code>npm run build</code> followed by{" "}
            <code>npm run start</code>.
          </li>
          <li>
            <strong>Enter your API key in Settings</strong> exactly as you would on the
            website. Everything from here is identical across operating systems.
          </li>
        </ol>

        <p className="reading text-muted">
          You can also deploy your own copy to <strong>Vercel</strong> in a couple of clicks
          (import the repo, deploy). Note the hosted limits: uploads up to ~4&nbsp;MB and a
          per-request time cap — long books work around the cap by continuing automatically
          across several requests, so they still finish in one sitting. Running locally has no
          such limits.
        </p>

        <div className="space-y-2">
          <div className="label">Optional · enable local models (Ollama)</div>
          <p className="reading">
            Ollama runs models on your own machine and only works in a local install.
            To turn it on, create a <code>.env.local</code> file from the included
            example, then set <code>NEXT_PUBLIC_ALLOW_OLLAMA=true</code> inside it. The
            copy command differs by OS:
          </p>
          <div className="space-y-2">
            <div>
              <span className="badge">Windows · PowerShell</span>
              <Cmd>Copy-Item .env.example .env.local</Cmd>
            </div>
            <div>
              <span className="badge">Windows · Command Prompt</span>
              <Cmd>copy .env.example .env.local</Cmd>
            </div>
            <div>
              <span className="badge">macOS / Linux</span>
              <Cmd>cp .env.example .env.local</Cmd>
            </div>
          </div>
          <p className="reading text-muted">
            You&apos;ll also need Ollama itself running — install it from{" "}
            <Link href="https://ollama.com">ollama.com</Link>.
          </p>
        </div>

        <div className="callout reading">
          <strong>Don&apos;t have Node.js yet?</strong> Install it from{" "}
          <Link href="https://nodejs.org">nodejs.org</Link> (Windows and macOS have
          one-click installers), via Homebrew on macOS (<code>brew install node</code>),
          or through your package manager / <Link href="https://github.com/nvm-sh/nvm">nvm</Link>{" "}
          on Linux. Then re-open your terminal so the <code>node</code> and{" "}
          <code>npm</code> commands are available.
        </div>
      </section>
    </div>
  );
}
