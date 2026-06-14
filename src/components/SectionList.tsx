"use client";

import type { Section, SectionResult } from "@/types";
import { wordCount } from "@/types";

interface Props {
  sections: Section[];
  checked: boolean[];
  results: Record<number, SectionResult>;
  selectedIdx: number | null;
  generating: boolean;
  onSelect: (idx: number) => void;
  onToggle: (idx: number) => void;
  onToggleAll: (value: boolean) => void;
  onRename: (idx: number) => void;
  onMerge: (idx: number, direction: "previous" | "next") => void;
  onClearResult: (idx: number) => void;
  onClearAll: () => void;
}

function statusMark(result: SectionResult | undefined): string {
  if (!result) return "";
  return result.error ? "⚠" : "✓";
}

export default function SectionList({
  sections,
  checked,
  results,
  selectedIdx,
  generating,
  onSelect,
  onToggle,
  onToggleAll,
  onRename,
  onMerge,
  onClearResult,
  onClearAll,
}: Props) {
  return (
    <div className="card flex h-full flex-col">
      <div className="mb-1 text-sm font-semibold">
        Sections{" "}
        <span className="font-normal text-muted">(check to include; double-click a title to rename)</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <button className="btn" onClick={() => onToggleAll(true)}>Check all</button>
        <button className="btn" onClick={() => onToggleAll(false)}>Uncheck all</button>
        <button className="btn" onClick={onClearAll}>Clear all results</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 p-1 text-center">Use?</th>
              <th className="p-1 text-left">Section</th>
              <th className="w-14 p-1 text-right">Words</th>
              <th className="w-6 p-1 text-center"></th>
              <th className="w-px p-1"></th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec, i) => {
              const selected = selectedIdx === i;
              return (
                <tr
                  key={i}
                  className={`cursor-pointer border-t border-border transition-colors ${
                    selected
                      ? "bg-[var(--selected)] text-[var(--selected-fg)]"
                      : "hover:bg-surface-2"
                  }`}
                  onClick={() => onSelect(i)}
                >
                  <td className="p-1 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked[i] ?? true}
                      onChange={() => onToggle(i)}
                    />
                  </td>
                  <td
                    className="p-1"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onRename(i);
                    }}
                    title={sec.title}
                  >
                    {sec.title}
                  </td>
                  <td className="p-1 text-right tabular-nums">{wordCount(sec)}</td>
                  <td className="p-1 text-center">
                    {results[i] && (
                      <span className={selected ? "" : results[i].error ? "status-warn" : "status-ok"}>
                        {statusMark(results[i])}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-1 text-xs">
                    {selected && (
                      <span onClick={(e) => e.stopPropagation()} className="flex gap-1">
                        <button className="btn-mini" title="Merge with previous" disabled={generating}
                          onClick={() => onMerge(i, "previous")}>↑</button>
                        <button className="btn-mini" title="Merge with next" disabled={generating}
                          onClick={() => onMerge(i, "next")}>↓</button>
                        <button className="btn-mini" title="Rename" onClick={() => onRename(i)}>✎</button>
                        <button className="btn-mini" title="Clear result" onClick={() => onClearResult(i)}>✕</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
