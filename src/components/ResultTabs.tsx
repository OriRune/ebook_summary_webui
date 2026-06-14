"use client";

import { useState } from "react";
import type { CharacterSummary, Section, SectionResult } from "@/types";

const TABS = ["Summary", "Flashcards", "Discussion", "Characters", "Section text"] as const;
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
    <div className="flex h-full flex-col">
      <div className="text-lg font-semibold">{section ? section.title : ""}</div>
      <div className="mt-2 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1 text-sm ${
              tab === t ? "bg-surface font-medium" : "text-muted hover:text-fg"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-b bg-surface p-3 text-sm">
        {renderTab(tab, section, result, isChecked, characterList, characterListError)}
      </div>
    </div>
  );
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
      return <em className="text-muted">Couldn&apos;t build the character list: {characterListError}</em>;
    }
    if (characterList.length === 0) {
      return <em className="text-muted">(no character list was produced for this run)</em>;
    }
    return (
      <div className="space-y-3">
        {characterList.map((c, i) => (
          <div key={i}>
            <div className="font-semibold">{c.name}</div>
            <div>{c.summary}</div>
          </div>
        ))}
      </div>
    );
  }

  if (!section) return <em className="text-muted">Select a section.</em>;

  if (tab === "Section text") return section.text;

  if (!result) {
    return (
      <em className="text-muted">
        {isChecked ? "(not generated yet)" : "(section unchecked — skipped)"}
      </em>
    );
  }
  if (result.error) {
    if (tab === "Summary") return <span className="text-red-500">Generation failed:{"\n"}{result.error}</span>;
    return "";
  }

  if (tab === "Summary") {
    return result.summary || <em className="text-muted">(summary wasn&apos;t requested for this run)</em>;
  }

  if (tab === "Flashcards") {
    if (result.flashcards.length === 0) {
      return <em className="text-muted">(flashcards weren&apos;t requested for this run)</em>;
    }
    return (
      <ol className="space-y-3">
        {result.flashcards.map((c, i) => (
          <li key={i}>
            <div>
              <span className="font-semibold">{c.cardType === "cloze" ? "Cloze:" : "Q:"}</span> {c.front}
            </div>
            {c.back && (
              <div className="text-muted">
                <span className="font-semibold">{c.cardType === "cloze" ? "Extra:" : "A:"}</span> {c.back}
              </div>
            )}
          </li>
        ))}
      </ol>
    );
  }

  // Discussion
  if (result.discussionQuestions.length === 0) {
    return <em className="text-muted">(discussion questions weren&apos;t requested for this run)</em>;
  }
  return (
    <ol className="list-decimal space-y-2 pl-5">
      {result.discussionQuestions.map((q, i) => (
        <li key={i}>{q}</li>
      ))}
    </ol>
  );
}
