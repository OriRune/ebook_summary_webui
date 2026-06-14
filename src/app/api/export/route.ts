/**
 * POST /api/export — build a downloadable export from the client's run state.
 *
 * Body: { kind, results, characterList?, bookTitle?, author?, fileStem? }
 *   kind ∈ "csv" | "cloze" | "md" | "docx" | "char" | "context"
 * Returns the file with a Content-Disposition attachment header.
 */
import { NextRequest, NextResponse } from "next/server";
import type { CharacterSummary, SectionResult } from "@/types";
import { exportFlashcardsCsv, exportClozeFlashcardsCsv } from "@/lib/export/csv";
import { exportSummariesMarkdown } from "@/lib/export/markdown";
import { exportSummariesDocx } from "@/lib/export/docx";
import {
  exportCharacterNotesMarkdown,
  exportContextNotesMarkdown,
} from "@/lib/export/notes";
import { exportBasename } from "@/lib/filename";
import { validateExportBody } from "@/lib/apiValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "csv" | "cloze" | "md" | "docx" | "char" | "context";

interface ExportBody {
  kind: Kind;
  results: SectionResult[];
  characterList?: CharacterSummary[] | null;
  bookTitle?: string;
  author?: string;
  fileStem?: string;
}

function download(
  body: BodyInit,
  filename: string,
  contentType: string
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  let parsed: ExportBody;
  try {
    parsed = (await req.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const invalid = validateExportBody(parsed);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  const {
    kind,
    results,
    characterList = null,
    bookTitle = "",
    author = "",
    fileStem = "ebook",
  } = parsed;

  const base = exportBasename(bookTitle, author, fileStem);

  switch (kind) {
    case "csv": {
      const { content } = exportFlashcardsCsv(results, bookTitle);
      return download(content, `${base}_flashcards.csv`, "text/csv; charset=utf-8");
    }
    case "cloze": {
      const { content } = exportClozeFlashcardsCsv(results, bookTitle);
      return download(content, `${base}_cloze_flashcards.csv`, "text/csv; charset=utf-8");
    }
    case "md": {
      const content = exportSummariesMarkdown(results, bookTitle, characterList);
      return download(content, `${base}_study_guide.md`, "text/markdown; charset=utf-8");
    }
    case "docx": {
      const buffer = await exportSummariesDocx(results, bookTitle, characterList);
      return download(
        new Uint8Array(buffer),
        `${base}_study_guide.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    }
    case "char": {
      const content = exportCharacterNotesMarkdown(results, bookTitle);
      if (content === null) {
        return NextResponse.json(
          { error: "No character notes have been generated yet." },
          { status: 400 }
        );
      }
      return download(content, `${base}_character_notes.md`, "text/markdown; charset=utf-8");
    }
    case "context": {
      const content = exportContextNotesMarkdown(results, bookTitle);
      if (content === null) {
        return NextResponse.json(
          { error: "No context notes have been generated yet." },
          { status: 400 }
        );
      }
      return download(content, `${base}_context_notes.md`, "text/markdown; charset=utf-8");
    }
    default:
      return NextResponse.json({ error: `Unknown export kind: ${kind}` }, { status: 400 });
  }
}
