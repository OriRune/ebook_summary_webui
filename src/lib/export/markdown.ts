/**
 * Markdown study-guide export, ported from exporter.py export_summaries_markdown.
 * Line assembly (including the embedded trailing "\n" on header lines) mirrors
 * the desktop output exactly, then joins with "\n".
 */
import type { CharacterSummary, SectionResult } from "@/types";
import { isCloze } from "@/types";

function uniqueModels(results: SectionResult[]): string[] {
  const used = results
    .filter((r) => !r.error && r.modelUsed)
    .map((r) => r.modelUsed);
  return Array.from(new Set(used)).sort();
}

export function exportSummariesMarkdown(
  results: SectionResult[],
  bookTitle = "",
  characterList: CharacterSummary[] | null = null
): string {
  const unique = uniqueModels(results);
  const lines: string[] = [];

  if (bookTitle) {
    lines.push(`# ${bookTitle} — Study Guide\n`);
  }
  if (unique.length === 1) {
    lines.push(`_Generated with: ${unique[0]}_\n`);
  } else if (unique.length > 1) {
    lines.push(`_Generated with multiple models: ${unique.join(", ")}_\n`);
  }

  if (characterList && characterList.length > 0) {
    lines.push("## Main Characters\n");
    for (const character of characterList) {
      lines.push(`**${character.name}**`);
      lines.push(`${character.summary}\n`);
    }
  }

  for (const result of results) {
    lines.push(`## ${result.title}\n`);
    if (result.error) {
      lines.push(`*Generation failed: ${result.error}*\n`);
      continue;
    }
    if (unique.length > 1 && result.modelUsed) {
      lines.push(`_Model: ${result.modelUsed}_\n`);
    }
    if (result.summary) {
      lines.push(`${result.summary}\n`);
    }
    if (result.flashcards.length > 0) {
      const basic = result.flashcards.filter((c) => !isCloze(c));
      const cloze = result.flashcards.filter((c) => isCloze(c));
      if (basic.length > 0) {
        lines.push("**Flashcards:**\n");
        for (const card of basic) {
          lines.push(`- **Q:** ${card.front}`);
          lines.push(`  **A:** ${card.back}`);
        }
        lines.push("");
      }
      if (cloze.length > 0) {
        lines.push(
          "**Cloze cards** (Anki fill-in-the-blank style — the " +
            "`{{c1::...}}` portion is the part you'd be asked to recall):\n"
        );
        for (const card of cloze) {
          lines.push(`- ${card.front}`);
          if (card.back) {
            lines.push(`  *${card.back}*`);
          }
        }
        lines.push("");
      }
    }
    if (result.discussionQuestions.length > 0) {
      lines.push("**Discussion questions:**\n");
      for (const question of result.discussionQuestions) {
        lines.push(`- ${question}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
