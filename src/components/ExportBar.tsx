"use client";

interface Props {
  hasResults: boolean;
  hasFlashcards: boolean;
  hasCloze: boolean;
  hasCharacterNotes: boolean;
  hasContextNotes: boolean;
  onExport: (kind: "csv" | "cloze" | "md" | "docx" | "char" | "context") => void;
}

export default function ExportBar({
  hasResults,
  hasFlashcards,
  hasCloze,
  hasCharacterNotes,
  hasContextNotes,
  onExport,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <button className="btn" disabled={!hasFlashcards} onClick={() => onExport("csv")}>
        Flashcards CSV (Anki Basic)
      </button>
      <button className="btn" disabled={!hasCloze} onClick={() => onExport("cloze")}>
        Flashcards CSV (Anki Cloze)
      </button>
      <button className="btn" disabled={!hasResults} onClick={() => onExport("md")}>
        Study guide (Markdown)
      </button>
      <button className="btn" disabled={!hasResults} onClick={() => onExport("docx")}>
        Study guide (Word)
      </button>
      <button className="btn" disabled={!hasCharacterNotes} onClick={() => onExport("char")}>
        Character notes
      </button>
      <button className="btn" disabled={!hasContextNotes} onClick={() => onExport("context")}>
        Context notes
      </button>
    </div>
  );
}
