"use client";

import { useState } from "react";
import type { CharacterSummary, Section, SectionResult } from "@/types";

const TABS = [
  "Summary",
  "Flashcards",
  "Discussion",
  "Section characters",
  "Characters",
  "Section text",
] as const;
type Tab = (typeof TABS)[number];

interface Props {
  section: Section | null;
  result: SectionResult | undefined;
  isChecked: boolean;
  characterList: CharacterSummary[];
  characterListError: string | null;
}

export default function ResultTabs({
  section,
  result,
  isChecked,
  characterList,
  characterListError,
}: Props) {
  const [tab, setTab] = useState<Tab>("Summary");

  return (
    <div className="card flex flex-col">
      <div className="truncate text-lg font-semibold" title={section?.title}>
        {section ? section.title : <span className="text-muted">No section selected</span>}
      </div>
      <div
        role="tablist"
        aria-label="Result views"
        className="mt-2 flex flex-wrap gap-4 border-b border-border"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const i = TABS.indexOf(tab);
          const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
          setTab(TABS[next]);
        }}
      >
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              role="tab"
              id={`tab-${t}`}
              aria-selected={active}
              aria-controls="result-tabpanel"
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ${
                active
                  ? "border-accent font-medium text-fg"
                  : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
      <div
        id="result-tabpanel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="max-h-[70vh] min-h-[12rem] overflow-auto pt-4"
      >
        {renderTab(tab, section, result, isChecked, characterList, characterListError)}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <em className="text-muted">{children}</em>;
}

function renderTab(
  tab: Tab,
  section: Section | null,
  result: SectionResult | undefined,
  isChecked: boolean,
  characterList: CharacterSummary[],
  characterListError: string | null
) {
  if (tab === "Characters") {
    if (characterListError && characterList.length === 0) {
      return <Empty>Couldn&apos;t build the character list: {characterListError}</Empty>;
    }
    if (characterList.length === 0) {
      return <Empty>(no character list was produced for this run)</Empty>;
    }
    return (
      <div className="space-y-3">
        {characterList.map((c, i) => (
          <div key={i} className="rounded-lg border border-border border-l-4 border-l-[var(--lavender)] bg-surface-2 p-3">
            <div className="font-semibold text-heading">{c.name}</div>
            <div className="reading mt-1">{c.summary}</div>
          </div>
        ))}
      </div>
    );
  }

  if (!section) return <Empty>Select a section.</Empty>;

  if (tab === "Section text") {
    return <div className="reading whitespace-pre-wrap">{section.text}</div>;
  }

  if (!result) {
    return <Empty>{isChecked ? "(not generated yet)" : "(section unchecked — skipped)"}</Empty>;
  }

  if (tab === "Section characters") {
    if (result.error) return "";
    if (result.characterNotes.length === 0) {
      return (
        <Empty>
          (no character notes for this section — enable the character guide and pick
          Fiction/Nonfiction before generating)
        </Empty>
      );
    }
    return (
      <div className="space-y-3">
        {result.characterNotes.map((c, i) => (
          <div
            key={i}
            className="rounded-lg border border-border border-l-4 border-l-[var(--lavender)] bg-surface-2 p-3"
          >
            <div className="font-semibold text-heading">{c.name}</div>
            <div className="reading mt-1">{c.note}</div>
          </div>
        ))}
      </div>
    );
  }

  if (result.error) {
    if (tab === "Summary") {
      return (
        <div className="rounded-lg border border-[var(--warn)] bg-surface-2 p-3 text-[var(--warn)]">
          Generation failed:{"\n"}
          {result.error}
        </div>
      );
    }
    return "";
  }

  if (tab === "Summary") {
    return result.summary ? (
      <div className="reading whitespace-pre-wrap">{result.summary}</div>
    ) : (
      <Empty>(summary wasn&apos;t requested for this run)</Empty>
    );
  }

  if (tab === "Flashcards") {
    if (result.flashcards.length === 0) {
      return <Empty>(flashcards weren&apos;t requested for this run)</Empty>;
    }
    return (
      <ol className="space-y-2.5">
        {result.flashcards.map((c, i) => {
          const cloze = c.cardType === "cloze";
          return (
            <li
              key={i}
              className={`rounded-lg border border-border bg-surface-2 p-3 ${
                cloze ? "border-l-4 border-l-[var(--lavender)]" : ""
              }`}
            >
              {cloze && (
                <span className="mb-1 inline-block rounded-full bg-[var(--lavender)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Cloze
                </span>
              )}
              <div className="reading">
                {!cloze && <span className="badge mr-2 align-middle">Q</span>}
                {c.front}
              </div>
              {c.back && (
                <div className="reading mt-1 text-muted">
                  <span className="font-semibold">{cloze ? "Extra: " : "A. "}</span>
                  {c.back}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  // Discussion
  if (result.discussionQuestions.length === 0) {
    return <Empty>(discussion questions weren&apos;t requested for this run)</Empty>;
  }
  return (
    <ol className="reading list-decimal space-y-3 pl-6 marker:font-semibold marker:text-heading">
      {result.discussionQuestions.map((q, i) => (
        <li key={i}>{q}</li>
      ))}
    </ol>
  );
}
