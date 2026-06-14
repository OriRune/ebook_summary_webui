"use client";

import { ALLOW_OLLAMA } from "@/hooks/useSettings";

interface Step {
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Choose a backend & enter your API key",
    body: (
      <>
        In <strong>Setup</strong>, pick a backend — Anthropic or Groq
        {ALLOW_OLLAMA ? ", or Ollama (local)" : ""} — and paste your API key. Your
        key is stored <strong>only in your browser</strong>, sent with each request,
        and never saved on our server. For Groq{ALLOW_OLLAMA ? "/Ollama" : ""}, hit{" "}
        <em>↺ Refresh</em> to load the model list.
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
        the book is chunked.
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
        section at a time with a live progress bar. <strong>Stop</strong> halts after
        the current section, and clicking Generate again <strong>resumes</strong> —
        only unfinished or failed sections are re-processed.
      </>
    ),
  },
  {
    title: "Browse the results",
    body: (
      <>
        Select a section and switch between the <strong>Summary</strong>,{" "}
        <strong>Flashcards</strong>, <strong>Discussion</strong>,{" "}
        <strong>Characters</strong>, and <strong>Section text</strong> tabs. The
        character guide is book-wide; the rest are per section.
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
            The cost estimate is a rough Anthropic figure (Sonnet pricing); actual usage
            varies with the book and the model&apos;s responses. Groq is shown as
            &ldquo;low&rdquo;; Ollama is free/local.
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
    </div>
  );
}
