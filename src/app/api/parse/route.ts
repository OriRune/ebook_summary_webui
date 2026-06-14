/**
 * POST /api/parse — multipart upload → parsed section list + detected title/author.
 *
 * Stateless: the full section list (title + text) is returned to the browser,
 * which holds run state. EPUB needs a real file path (epub2 requirement), so we
 * write the upload to an OS temp file with a suffix derived from the extension
 * (never the user's filename) and clean it up afterward.
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  splitEbook,
  detectTitleAuthor,
  fileExt,
  isSupportedExt,
} from "@/lib/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel serverless functions cap the request body at ~4.5 MB, so the hosted
// site can't accept larger uploads regardless. Keep a little headroom; users with
// bigger books can run the app locally (see the "How to use" page).
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "File too large — the hosted site accepts uploads up to 4 MB. " +
            "For larger books, run the app locally (see the How to use page).",
        },
        { status: 400 }
      );
    }

    const ext = fileExt(file.name);
    if (!isSupportedExt(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext || "(none)"}. Supported: .txt, .md, .epub, .pdf` },
        { status: 400 }
      );
    }

    const maxCharsRaw = form.get("maxChars");
    const maxChars =
      typeof maxCharsRaw === "string" && Number.isFinite(Number(maxCharsRaw))
        ? Math.max(2000, Math.trunc(Number(maxCharsRaw)))
        : 9000;

    const buffer = Buffer.from(await file.arrayBuffer());

    let input: { text?: string; path?: string; buffer?: Buffer };
    if (ext === ".epub") {
      tempPath = join(tmpdir(), `ebook-${randomUUID()}.epub`);
      await writeFile(tempPath, buffer);
      input = { path: tempPath };
    } else if (ext === ".pdf") {
      input = { buffer };
    } else {
      input = { text: new TextDecoder("utf-8").decode(buffer) };
    }

    const sections = await splitEbook(ext, input, maxChars);
    const [title, author] = await detectTitleAuthor(ext, input);

    return NextResponse.json({ sections, title, author });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse file.";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => {});
    }
  }
}
