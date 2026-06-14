"use client";

import type { ContentType } from "@/types";
import type { Settings } from "@/hooks/useSettings";

interface Props {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  costText: string;
}

export default function GenerateOptions({ settings, update, costText }: Props) {
  const characterAllowed =
    settings.contentType === "fiction" || settings.contentType === "nonfiction";

  return (
    <div className="space-y-2 text-sm">
      <div className="label">What to generate</div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-muted">Generate:</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={settings.includeSummary}
            onChange={(e) => update("includeSummary", e.target.checked)} />
          Summary
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={settings.includeFlashcards}
            onChange={(e) => update("includeFlashcards", e.target.checked)} />
          Flashcards
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={settings.includeDiscussion}
            onChange={(e) => update("includeDiscussion", e.target.checked)} />
          Discussion questions
        </label>

        <label className="flex items-center gap-1">
          <span className="text-muted">Content is:</span>
          <select
            className="field"
            value={settings.contentType}
            onChange={(e) => {
              const ct = e.target.value as ContentType;
              update("contentType", ct);
              if (ct === "auto") update("includeCharacterList", false);
            }}
          >
            <option value="auto">Auto-detect</option>
            <option value="fiction">Fiction</option>
            <option value="nonfiction">Nonfiction</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={settings.includeContextDigest}
            onChange={(e) => update("includeContextDigest", e.target.checked)} />
          Carry story context forward between sections
        </label>
        <label className={`flex items-center gap-1 ${characterAllowed ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            disabled={!characterAllowed}
            checked={settings.includeCharacterList && characterAllowed}
            onChange={(e) => update("includeCharacterList", e.target.checked)}
          />
          Create character list{" "}
          <span className="text-muted">(set Content to Fiction or Nonfiction to enable)</span>
        </label>
      </div>

      <div className="text-xs text-muted">{costText}</div>
    </div>
  );
}
