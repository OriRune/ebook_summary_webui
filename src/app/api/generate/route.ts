/**
 * POST /api/generate — server-orchestrated SSE generation run.
 *
 * Mirrors the desktop worker thread: iterates the sections to process in book
 * order, maintaining the rolling context digest and a ChapterContinuityTracker
 * across the run, streaming one SectionResult per section as it completes, then
 * the character-list consolidation, then a terminal event. The client aborting
 * the request is the "Stop" signal.
 *
 * Request body:
 *   { sections, toProcess, options, backend, model, apiKey,
 *     bookTitle?, initialContext?, initialNotes? }
 */
import { NextRequest, NextResponse } from "next/server";
import type {
  Backend,
  CharacterNote,
  GenerateOptions,
  Section,
} from "@/types";
import { generateSectionContent } from "@/lib/llm/generate";
import { consolidateCharacterList } from "@/lib/llm/consolidate";
import { ChapterContinuityTracker } from "@/lib/llm/chapterContinuity";
import { DEFAULT_MODEL } from "@/lib/llm/prompts";
import { validateGenerateBody } from "@/lib/apiValidation";
import { shouldStopForTime } from "@/lib/generationBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps function duration at 60s (Hobby) / up to 300s (Pro). Long books
// won't finish in one request, so the loop self-limits by time (see below) and
// emits an "incomplete" event before the platform kills it; the client then
// resumes the next batch automatically. Pro users can raise this to 300.
export const maxDuration = 60;
const HARD_LIMIT_MS = maxDuration * 1000;

interface GenerateBody {
  sections: Section[];
  toProcess: number[];
  options: GenerateOptions;
  backend: Backend;
  model?: string;
  apiKey?: string;
  bookTitle?: string;
  initialContext?: string | null;
  initialNotes?: Array<[string, CharacterNote[]]>;
}

export async function POST(req: NextRequest) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const invalid = validateGenerateBody(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  const {
    sections,
    toProcess,
    options,
    backend,
    model = DEFAULT_MODEL,
    apiKey = "",
    bookTitle = "",
    initialContext = null,
    initialNotes = [],
  } = body;

  const includeCharacterList =
    options.includeCharacterList &&
    (options.contentType === "fiction" || options.contentType === "nonfiction");

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const notesBySection: Array<[string, CharacterNote[]]> = [...initialNotes];
      let priorContext: string | null = initialContext;
      const tracker = new ChapterContinuityTracker();
      let stopped = false;
      let timedOut = false;

      const runStart = Date.now();
      let completed = 0;

      try {
        const total = toProcess.length;
        for (let n = 0; n < total; n++) {
          if (req.signal.aborted) {
            stopped = true;
            break;
          }
          // Stop gracefully before the host's hard duration cap would sever the
          // stream; the client resumes the remaining sections automatically.
          const elapsedMs = Date.now() - runStart;
          const avgSectionMs = completed > 0 ? elapsedMs / completed : 0;
          if (shouldStopForTime({ elapsedMs, avgSectionMs, hardLimitMs: HARD_LIMIT_MS })) {
            timedOut = true;
            break;
          }
          const idx = toProcess[n];
          const sec = sections[idx];
          send({ type: "progress", n, total, title: sec.title });

          const [chapterFronts, chapterQuestions] = tracker.contextFor(sec.title);

          const result = await generateSectionContent({
            apiKey,
            sectionTitle: sec.title,
            sectionText: sec.text,
            includeSummary: options.includeSummary,
            includeFlashcards: options.includeFlashcards,
            includeDiscussion: options.includeDiscussion,
            includeCharacterNotes: includeCharacterList,
            includeContextDigest: options.includeContextDigest,
            priorContext,
            priorChapterFlashcardFronts: chapterFronts,
            priorChapterDiscussionQuestions: chapterQuestions,
            contentType: options.contentType,
            backend,
            model,
          });

          send({ type: "result", idx, result });

          if (includeCharacterList && !result.error && result.characterNotes.length > 0) {
            notesBySection.push([sec.title, result.characterNotes]);
          }
          if (options.includeContextDigest && !result.error && result.contextDigest) {
            priorContext = result.contextDigest;
          }
          if (!result.error) {
            tracker.record(
              sec.title,
              result.flashcards.map((c) => c.front),
              [...result.discussionQuestions]
            );
          }
          completed++;
        }

        // Only consolidate the character list once the whole run is finished —
        // not on a batch that stopped early for time (the final batch, which has
        // every section's notes via the client's reconstructed initialNotes,
        // runs it). Otherwise we'd emit a premature/partial list.
        const finishedRun = !stopped && !timedOut;
        if (includeCharacterList && notesBySection.length > 0 && finishedRun) {
          send({ type: "character_list_started" });
          const { characters, error } = await consolidateCharacterList(
            apiKey,
            bookTitle,
            notesBySection,
            model,
            backend
          );
          send({ type: "character_list", characters, error });
        } else if (includeCharacterList && finishedRun) {
          send({
            type: "character_list",
            characters: [],
            error:
              "No checked sections produced character notes (try checking more sections, " +
              "or generating again if some failed).",
          });
        }

        send({ type: stopped ? "stopped" : timedOut ? "incomplete" : "done" });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
