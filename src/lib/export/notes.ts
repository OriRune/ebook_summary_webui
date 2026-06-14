/**
 * Character-notes and context-notes Markdown exports, ported from main.py
 * _on_export_character_notes / _on_export_context_notes. Both skip errored and
 * empty sections, preserving section order. Return null when there's nothing to
 * export (the caller surfaces a "nothing to export" message).
 */
import type { SectionResult } from "@/types";

export function exportCharacterNotesMarkdown(
  results: SectionResult[],
  bookTitle: string
): string | null {
  const sectionsWithNotes = results.filter(
    (r) => !r.error && r.characterNotes.length > 0
  );
  if (sectionsWithNotes.length === 0) return null;

  const book = bookTitle || "this book";
  const lines: string[] = [
    `# Character Notes — ${book}\n`,
    "_Per-section observations gathered during generation. " +
      "These were used to build the full character list._\n",
  ];
  for (const r of sectionsWithNotes) {
    lines.push(`\n## ${r.title}\n`);
    for (const note of r.characterNotes) {
      lines.push(`**${note.name}**: ${note.note}\n`);
    }
  }
  return lines.join("\n");
}

export function exportContextNotesMarkdown(
  results: SectionResult[],
  bookTitle: string
): string | null {
  const sectionsWithContext = results.filter((r) => !r.error && r.contextDigest);
  if (sectionsWithContext.length === 0) return null;

  const book = bookTitle || "this book";
  const lines: string[] = [
    `# Rolling Context Notes — ${book}\n`,
    "_The 'story so far' digest produced after each section and " +
      "passed forward to the next as background context._\n",
  ];
  for (const r of sectionsWithContext) {
    lines.push(`\n## ${r.title}\n`);
    lines.push(r.contextDigest);
  }
  return lines.join("\n");
}
