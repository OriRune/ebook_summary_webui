/**
 * LLM backend dispatch, ported from llm_client.py (_call_ollama / _call_groq /
 * the inline Anthropic call) and generalized. Each returns the raw assistant
 * text; the caller parses JSON out of it. Runs server-side only (API routes).
 *
 * Most providers (OpenAI, Gemini, OpenRouter, Groq) speak the OpenAI Chat
 * Completions format, so they share one handler parameterized by base URL +
 * key. Anthropic uses its native SDK; Ollama talks to a local daemon.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Ollama } from "ollama";
import type { Backend } from "@/types";
import { PROVIDERS } from "./providers";

export function ollamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || "http://localhost:11434";
}

const USER_AGENT = "ebook-flashcards/1.0";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callOllama(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const client = new Ollama({ host: ollamaBaseUrl() });
  const response = await client.chat({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      // /no_think suppresses Qwen3's chain-of-thought reasoning blocks; it's a
      // no-op for models that don't support it, so it's safe to send always.
      { role: "user", content: `/no_think\n\n${userMessage}` },
    ],
    stream: false,
    options: { num_predict: maxTokens },
  });
  return response.message.content;
}

interface OpenAICompatibleOptions {
  providerLabel: string;
  /** Body field for the output cap; defaults to "max_tokens". */
  maxTokensField?: string;
  /** Extra headers (e.g. OpenRouter ranking headers). */
  extraHeaders?: Record<string, string>;
}

/**
 * Generic OpenAI Chat Completions client (OpenAI, Gemini, OpenRouter, Groq).
 * Retries on 429 using Retry-After, and surfaces 413 (context too large) with
 * an actionable message. `providerLabel` makes the errors provider-specific.
 */
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  { providerLabel, maxTokensField = "max_tokens", extraHeaders = {} }: OpenAICompatibleOptions
): Promise<string> {
  const payload = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    [maxTokensField]: maxTokens,
  });

  const maxRetries = 8;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
        ...extraHeaders,
      },
      body: payload,
    });

    if (resp.ok) {
      const data = await resp.json();
      return (data.choices?.[0]?.message?.content ?? "") as string;
    }

    if (resp.status === 429 && attempt < maxRetries - 1) {
      // Many providers return a Retry-After header (seconds until the
      // rate-limit window resets). Short waits → sleep and retry. Long waits
      // (>120s) mean a harder quota cap, so surface a clear error.
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? parseFloat(retryAfter) : Math.min(2 ** attempt + 1, 60);
      if (wait > 120) {
        throw new Error(
          `${providerLabel} rate limit: quota exceeded — server asked us to wait ` +
            `${wait.toFixed(0)}s (${(wait / 60).toFixed(1)} min). You've likely hit a ` +
            `token or request cap. Wait for the quota to reset (check your provider ` +
            `dashboard), or switch to a higher plan.`
        );
      }
      await sleep(wait * 1000);
      continue;
    }

    if (resp.status === 413) {
      throw new Error(
        `Section too large for this ${providerLabel} model (HTTP 413). ` +
          "Try reducing 'Max chars/section' in the settings (e.g. to 4000–6000), " +
          "or switch to a model with a larger context window."
      );
    }

    // Other errors: surface with the body for debugging.
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      message = body?.error?.message || message;
    } catch {
      /* ignore body parse failure */
    }
    throw new Error(`${providerLabel} request failed: ${message}`);
  }

  // Exhausted retries on repeated 429s.
  throw new Error(`${providerLabel} rate limit: retries exhausted.`);
}

/** OpenRouter recommends these headers for app ranking; both are optional. */
function openRouterHeaders(): Record<string, string> {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return {};
  return { "HTTP-Referer": site, "X-Title": "Ebook Study-Aid Generator" };
}

export interface CallModelOptions {
  backend: Backend;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

/** Dispatch one completion call to the selected backend. Returns raw text. */
export async function callModel({
  backend,
  apiKey,
  model,
  systemPrompt,
  userMessage,
  maxTokens = 4096,
}: CallModelOptions): Promise<string> {
  const provider = PROVIDERS[backend];
  if (!provider) throw new Error(`Unknown backend: ${backend}`);

  if (provider.kind === "ollama") {
    if (!model) throw new Error("No Ollama model selected.");
    return callOllama(model, systemPrompt, userMessage, maxTokens);
  }

  if (provider.kind === "anthropic") {
    if (!apiKey) throw new Error("No Anthropic API key configured.");
    return callAnthropic(apiKey, model, systemPrompt, userMessage, maxTokens);
  }

  // openai-compatible (OpenAI, Gemini, OpenRouter, Groq)
  if (!apiKey) throw new Error(`No ${provider.label} API key configured.`);
  if (!model) throw new Error(`No ${provider.label} model selected.`);
  return callOpenAICompatible(
    provider.baseUrl!,
    apiKey,
    model,
    systemPrompt,
    userMessage,
    maxTokens,
    {
      providerLabel: provider.label,
      maxTokensField: provider.maxTokensField,
      extraHeaders: backend === "openrouter" ? openRouterHeaders() : {},
    }
  );
}
