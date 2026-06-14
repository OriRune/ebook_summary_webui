"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterSummary, Section, SectionResult } from "@/types";
import { charCount } from "@/types";
import { estimateRunCost, estimateUsd } from "@/lib/llm/cost";
import {
  mergeSections,
  renameSection,
  renameChapterParts,
  chapterSiblings,
  previewMergedTitle,
} from "@/lib/sections";
import {
  toProcessIndices,
  reconstructInitialNotes,
  reconstructInitialContext,
} from "@/lib/resume";
import { saveRun, loadRun } from "@/lib/persistence";
import { useSettings, ALLOW_OLLAMA } from "@/hooks/useSettings";
import SettingsPanel from "@/components/SettingsPanel";
import GenerateOptions from "@/components/GenerateOptions";
import SectionList from "@/components/SectionList";
import ResultTabs from "@/components/ResultTabs";
import ExportBar from "@/components/ExportBar";
import HowToUse from "@/components/HowToUse";

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export default function Home() {
  const { settings, update, loaded } = useSettings();

  const [sections, setSections] = useState<Section[]>([]);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [results, setResults] = useState<Record<number, SectionResult>>({});
  const [characterList, setCharacterList] = useState<CharacterSummary[]>([]);
  const [characterListError, setCharacterListError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [fileStem, setFileStem] = useState("ebook");
  const [view, setView] = useState<"generate" | "guide">("generate");

  const [status, setStatus] = useState("Open an ebook (.txt, .md, .epub, .pdf) to begin.");
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ n: number; total: number; title: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [eta, setEta] = useState<number | null>(null);

  const lastFile = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoredRef = useRef(false);

  // Restore persisted run on mount.
  useEffect(() => {
    (async () => {
      const run = await loadRun();
      if (run) {
        setSections(run.sections);
        setChecked(run.checked);
        setResults(run.results);
        setCharacterList(run.characterList);
        setCharacterListError(run.characterListError);
        setSelectedIdx(run.selectedIdx);
        setBookTitle(run.title);
        setAuthor(run.author);
        setFileStem(run.fileStem);
        if (run.sections.length) {
          setStatus(`Restored ${run.sections.length} section(s) from your last session.`);
        }
      }
      restoredRef.current = true;
    })();
  }, []);

  // Persist run whenever it changes (after restore completes).
  useEffect(() => {
    if (!restoredRef.current) return;
    saveRun({
      fileStem,
      title: bookTitle,
      author,
      sections,
      checked,
      results,
      characterList,
      characterListError,
      selectedIdx,
    }).catch(() => {});
  }, [sections, checked, results, characterList, characterListError, selectedIdx, bookTitle, author, fileStem]);

  // ---------------------------------------------------------------- parsing

  const parseFile = useCallback(
    async (file: File) => {
      setParsing(true);
      setStatus(`Parsing ${file.name}…`);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("maxChars", String(settings.maxChars));
        const resp = await fetch("/api/parse", { method: "POST", body: form });
        const data = await resp.json();
        if (!resp.ok) {
          setStatus(`Couldn't parse file: ${data.error}`);
          return;
        }
        const stem = file.name.replace(/\.[^.]+$/, "");
        setSections(data.sections);
        setChecked(new Array(data.sections.length).fill(true));
        setResults({});
        setCharacterList([]);
        setCharacterListError(null);
        setSelectedIdx(data.sections.length ? 0 : null);
        setBookTitle(data.title || stem);
        setAuthor(data.author || "");
        setFileStem(stem);
        setStatus(
          `Split into ${data.sections.length} section(s). Uncheck any to skip, then Generate.`
        );
      } catch (e) {
        setStatus(`Couldn't parse file: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setParsing(false);
      }
    },
    [settings.maxChars]
  );

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    lastFile.current = file;
    parseFile(file);
  }

  // ---------------------------------------------------------------- sections

  const toggle = (idx: number) =>
    setChecked((c) => c.map((v, i) => (i === idx ? !v : v)));
  const toggleAll = (value: boolean) => setChecked((c) => c.map(() => value));

  function rename(idx: number) {
    const siblings = chapterSiblings(sections, idx);
    if (siblings.length > 1) {
      const whole = window.confirm(
        `"${sections[idx].title}" is one of ${siblings.length} parts of a chapter.\n\n` +
          `OK = rename the WHOLE chapter (all parts).\nCancel = rename just this part.`
      );
      if (whole) {
        const newBase = window.prompt("New chapter title:");
        if (newBase && newBase.trim()) {
          setSections((s) => renameChapterParts(s, siblings, newBase.trim()));
        }
        return;
      }
    }
    const newTitle = window.prompt("New title:", sections[idx].title);
    if (newTitle && newTitle.trim() && newTitle.trim() !== sections[idx].title) {
      setSections((s) => renameSection(s, idx, newTitle.trim()));
    }
  }

  function merge(idx: number, direction: "previous" | "next") {
    const preview = previewMergedTitle(sections, idx, direction);
    if (preview === null) {
      setStatus(direction === "previous" ? "Already the first section." : "Already the last section.");
      return;
    }
    if (!window.confirm(`Merge into "${preview}"? Any generated results for the two will be cleared.`)) {
      return;
    }
    const next = mergeSections({ sections, checked, results }, idx, direction);
    if (!next) return;
    setSections(next.sections);
    setChecked(next.checked);
    setResults(next.results);
    setSelectedIdx(next.selected);
  }

  function clearResult(idx: number) {
    setResults((r) => {
      const next = { ...r };
      delete next[idx];
      return next;
    });
  }

  function clearAll() {
    if (Object.keys(results).length === 0) {
      setStatus("No results to clear.");
      return;
    }
    if (!window.confirm("Clear all generated results? The sections themselves are kept.")) return;
    setResults({});
    setCharacterList([]);
    setCharacterListError(null);
    setStatus("Cleared all results.");
  }

  // -------------------------------------------------------------- generation

  function stopGeneration() {
    abortRef.current?.abort();
    setStatus("Stopping after the current section finishes…");
  }

  async function startGeneration() {
    if (generating) return;
    if (!(settings.includeSummary || settings.includeFlashcards || settings.includeDiscussion)) {
      setStatus("Check at least one of Summary, Flashcards, or Discussion questions.");
      return;
    }
    const apiKey =
      settings.backend === "anthropic"
        ? settings.anthropicKey
        : settings.backend === "groq"
          ? settings.groqKey
          : "";
    const model =
      settings.backend === "anthropic"
        ? settings.anthropicModel
        : settings.backend === "groq"
          ? settings.groqModel
          : settings.ollamaModel;
    if (settings.backend !== "ollama" && !apiKey) {
      setStatus("Enter your API key first.");
      return;
    }
    if (settings.backend !== "anthropic" && !model) {
      setStatus("Select a model first (↺ Refresh if the list is empty).");
      return;
    }

    const checkedIndices = sections.map((_, i) => i).filter((i) => checked[i]);
    if (checkedIndices.length === 0) {
      setStatus("Check at least one section to generate content for.");
      return;
    }
    const toProcess = toProcessIndices(checkedIndices, results);
    if (toProcess.length === 0) {
      setStatus("All checked sections already have results. Clear a result to regenerate.");
      return;
    }

    // Reconstruct accumulated character notes + last good context digest.
    const initialNotes = reconstructInitialNotes(sections, results);
    const initialContext = reconstructInitialContext(results);

    setGenerating(true);
    setEta(null);
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          sections,
          toProcess,
          options: {
            includeSummary: settings.includeSummary,
            includeFlashcards: settings.includeFlashcards,
            includeDiscussion: settings.includeDiscussion,
            includeCharacterList: settings.includeCharacterList,
            includeContextDigest: settings.includeContextDigest,
            contentType: settings.contentType,
          },
          backend: settings.backend,
          model,
          apiKey,
          bookTitle,
          initialContext,
          initialNotes,
        }),
      });
      if (!resp.body) throw new Error("No response stream.");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const total = toProcess.length;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === "progress") {
            setProgress({ n: evt.n, total: evt.total, title: evt.title });
            setStatus(`Generating section ${evt.n + 1} of ${evt.total}: ${evt.title}`);
            if (evt.n > 0) {
              const avg = (Date.now() - startTimeRef.current) / 1000 / evt.n;
              setEta(avg * (evt.total - evt.n));
            }
          } else if (evt.type === "result") {
            setResults((r) => ({ ...r, [evt.idx]: evt.result }));
          } else if (evt.type === "character_list_started") {
            setStatus("All sections done — building character list…");
          } else if (evt.type === "character_list") {
            setCharacterList(evt.characters);
            setCharacterListError(evt.error);
          } else if (evt.type === "done") {
            setStatus(`Done. Generated ${total} section(s).`);
          } else if (evt.type === "stopped") {
            setStatus("Stopped.");
          } else if (evt.type === "error") {
            setStatus(`Generation error: ${evt.error}`);
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus("Stopped.");
      } else {
        setStatus(`Generation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setGenerating(false);
      setProgress(null);
      setEta(null);
      abortRef.current = null;
    }
  }

  // ------------------------------------------------------------------ export

  async function handleExport(kind: "csv" | "cloze" | "md" | "docx" | "char" | "context") {
    const ordered = sections
      .map((_, i) => results[i])
      .filter((r): r is SectionResult => Boolean(r));
    const resp = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        results: ordered,
        characterList,
        bookTitle,
        author,
        fileStem,
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ error: "Export failed." }));
      setStatus(data.error || "Export failed.");
      return;
    }
    const blob = await resp.blob();
    const disposition = resp.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match ? match[1] : "export";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------- derived UI

  const costText = (() => {
    if (sections.length === 0) return "";
    const nChecked = checked.filter(Boolean).length;
    if (settings.backend === "ollama") {
      return `Cost: free (local model — no API charges). ${nChecked} section(s) checked.`;
    }
    if (settings.backend === "groq") {
      return `Cost: low (Groq pricing — see groq.com/pricing). ${nChecked} section(s) checked.`;
    }
    const charCounts = sections.filter((_, i) => checked[i]).map((s) => charCount(s));
    const est = estimateRunCost(charCounts, {
      wantSummary: settings.includeSummary,
      wantFlashcards: settings.includeFlashcards,
      wantDiscussion: settings.includeDiscussion,
      wantCharacterList: settings.includeCharacterList,
      wantContextDigest: settings.includeContextDigest,
      wantChapterContinuity: true,
    });
    if (est.inputTokens + est.outputTokens === 0) {
      return "Estimated cost: — (check at least one section and one of Summary / Flashcards / Discussion).";
    }
    return (
      `Estimated for this run: ~${est.inputTokens.toLocaleString()} input + ` +
      `~${est.outputTokens.toLocaleString()} output tokens ≈ $${estimateUsd(est).toFixed(2)} ` +
      `— a rough approximation; actual usage varies.`
    );
  })();

  const resultValues = Object.values(results);
  const hasResults = resultValues.length > 0;
  const hasFlashcards = resultValues.some((r) => r.flashcards.length > 0);
  const hasCloze = resultValues.some((r) => r.flashcards.some((c) => c.cardType === "cloze"));
  const hasCharacterNotes = resultValues.some((r) => !r.error && r.characterNotes.length > 0);
  const hasContextNotes = resultValues.some((r) => !r.error && r.contextDigest);

  if (!loaded) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <span
            className="h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-[var(--coral)] to-[var(--lavender)] shadow-soft"
            aria-hidden
          />
          <h1 className="text-base font-bold tracking-tight sm:text-lg">
            Ebook <span className="text-muted">→</span> Summaries &amp; Flashcards
          </h1>
          <nav className="flex items-center gap-1 sm:ml-2">
            <button
              className={`nav-tab ${view === "generate" ? "nav-tab-active" : ""}`}
              onClick={() => setView("generate")}
            >
              Generate
            </button>
            <button
              className={`nav-tab ${view === "guide" ? "nav-tab-active" : ""}`}
              onClick={() => setView("guide")}
            >
              How to use
            </button>
          </nav>
          <button
            className="btn ml-auto px-2 py-1 text-sm"
            onClick={() => update("darkMode", !settings.darkMode)}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            {settings.darkMode ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
        <div className="h-0.5 w-full bg-gradient-to-r from-[var(--coral)] via-[var(--wisteria)] to-[var(--lavender)]" />
      </header>

      <main className="mx-auto max-w-[1240px] space-y-4 p-4 sm:p-6">
        {view === "guide" ? (
          <HowToUse />
        ) : (
          <>
            <section className="card space-y-3 border-l-4 border-l-[var(--wisteria)]">
              <div className="label">Setup</div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="btn-primary cursor-pointer">
                  Open ebook…
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,.epub,.pdf"
                    className="hidden"
                    onChange={onUpload}
                  />
                </label>
                {lastFile.current && (
                  <button
                    className="btn"
                    disabled={parsing || generating}
                    onClick={() => lastFile.current && parseFile(lastFile.current)}
                  >
                    Re-split
                  </button>
                )}
                <span className="truncate text-sm text-muted">
                  {parsing ? "Parsing…" : lastFile.current?.name ?? "No file loaded"}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <label className="flex flex-1 items-center gap-1.5 sm:flex-none">
                  <span className="text-muted">Book title</span>
                  <input
                    className="field w-full sm:w-60"
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                  />
                </label>
                <label className="flex flex-1 items-center gap-1.5 sm:flex-none">
                  <span className="text-muted">Author</span>
                  <input
                    className="field w-full sm:w-44"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </label>
              </div>

              <div className="border-t border-border pt-3">
                <SettingsPanel settings={settings} update={update} allowOllama={ALLOW_OLLAMA} />
              </div>
            </section>

            <section className="card space-y-3 border-l-4 border-l-[var(--lavender)]">
              <GenerateOptions settings={settings} update={update} costText={costText} />

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <button
                  className="btn-primary"
                  disabled={generating || sections.length === 0}
                  onClick={startGeneration}
                >
                  Generate for checked sections
                </button>
                <button className="btn" disabled={!generating} onClick={stopGeneration}>
                  Stop
                </button>
                {generating && progress && (
                  <div className="flex w-full items-center gap-3 text-sm sm:w-auto sm:flex-1">
                    <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-surface-2 sm:max-w-xs">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${progress.total ? (progress.n / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="whitespace-nowrap text-muted">
                      Elapsed {fmtDuration(elapsed)}
                      {eta !== null && ` · About ${fmtDuration(eta)} left`}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-3">
                <ExportBar
                  hasResults={hasResults}
                  hasFlashcards={hasFlashcards}
                  hasCloze={hasCloze}
                  hasCharacterNotes={hasCharacterNotes}
                  hasContextNotes={hasContextNotes}
                  onExport={handleExport}
                />
              </div>

              <div className="text-xs text-muted">{status}</div>
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
              <SectionList
                sections={sections}
                checked={checked}
                results={results}
                selectedIdx={selectedIdx}
                generating={generating}
                onSelect={setSelectedIdx}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onRename={rename}
                onMerge={merge}
                onClearResult={clearResult}
                onClearAll={clearAll}
              />
              <ResultTabs
                section={selectedIdx !== null ? sections[selectedIdx] ?? null : null}
                result={selectedIdx !== null ? results[selectedIdx] : undefined}
                isChecked={selectedIdx !== null ? (checked[selectedIdx] ?? true) : true}
                characterList={characterList}
                characterListError={characterListError}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
