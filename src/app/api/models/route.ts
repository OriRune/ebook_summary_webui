/**
 * POST /api/models — list available models for a backend.
 *
 * Body: { backend, apiKey? }
 * Returns: { models: string[], error: string | null }
 *
 * Sent as POST (not GET) so the API key never lands in a URL/log. Ollama is
 * gated behind NEXT_PUBLIC_ALLOW_OLLAMA so it can be disabled on public deploys.
 */
import { NextRequest, NextResponse } from "next/server";
import { getOllamaModels, getOpenAICompatibleModels } from "@/lib/llm/models";
import { PROVIDERS } from "@/lib/llm/providers";
import { isBackend } from "@/lib/apiValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let backend: string | undefined;
  let apiKey: string | undefined;
  try {
    ({ backend, apiKey } = (await req.json()) as { backend?: string; apiKey?: string });
  } catch {
    return NextResponse.json({ models: [], error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isBackend(backend)) {
    return NextResponse.json(
      { models: [], error: `Unknown backend: ${backend}` },
      { status: 400 }
    );
  }

  const provider = PROVIDERS[backend];

  if (provider.kind === "ollama") {
    if (process.env.NEXT_PUBLIC_ALLOW_OLLAMA !== "true") {
      return NextResponse.json({
        models: [],
        error: "Ollama is disabled on this deployment.",
      });
    }
    return NextResponse.json(await getOllamaModels());
  }

  if (provider.kind === "openai-compatible") {
    return NextResponse.json(
      await getOpenAICompatibleModels(provider.baseUrl!, apiKey || "", {
        exclude: provider.modelExclude,
        stripPrefix: provider.stripModelPrefix,
      })
    );
  }

  // Anthropic has no model-discovery endpoint here (free-text model input).
  return NextResponse.json({
    models: [],
    error: `Model listing is not available for ${provider.label}.`,
  });
}
