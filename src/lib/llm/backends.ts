/**
 * LLM backend dispatch, ported from llm_client.py (_call_ollama / _call_groq /
 * the inline Anthropic call). Each returns the raw assistant text; the caller
 * parses JSON out of it. Runs server-side only (API routes).
 */
import Anthropic from "@anthropic-ai/sdk";
import { Ollama } from "ollama";
import type { Backend } from "@/types";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

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

async function callGroq(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const payload = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: maxTokens,
  });

  const maxRetries = 8;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
      },
      body: payload,
    });

    if (resp.ok) {
      const data = await resp.json();
      return data.choices[0].message.content as string;
    }

    if (resp.status === 429 && attempt < maxRetries - 1) {
      // Groq returns a Retry-After header (seconds until the rate-limit window
      // resets). Short waits → sleep and retry. Long waits (>120s) mean a
      // harder quota cap, so surface a clear error rather than hanging.
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? parseFloat(retryAfter) : Math.min(2 ** attempt + 1, 60);
      if (wait > 120) {
        throw new Error(
          `Groq rate limit: quota exceeded — server asked us to wait ` +
            `${wait.toFixed(0)}s (${(wait / 60).toFixed(1)} min). You've likely hit the free-tier ` +
            `daily token or request cap. Wait for the quota to reset (check ` +
            `console.groq.com for your usage), or switch to a paid plan.`
        );
      }
      await sleep(wait * 1000);
      continue;
    }

    if (resp.status === 413) {
      throw new Error(
        "Section too large for this Groq model (HTTP 413). " +
          "Try reducing 'Max chars/section' in the settings (e.g. to 4000–6000), " +
          "or switch to a model with a larger context window such as " +
          "llama-3.1-8b-instant or llama-3.3-70b-versatile."
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
    throw new Error(`Groq request failed: ${message}`);
  }

  // Exhausted retries on repeated 429s.
  throw new Error("Groq rate limit: retries exhausted.");
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
  if (backend === "ollama") {
    if (!model) throw new Error("No Ollama model selected.");
    return callOllama(model, systemPrompt, userMessage, maxTokens);
  }
  if (backend === "groq") {
    if (!apiKey) throw new Error("No Groq API key configured.");
    if (!model) throw new Error("No Groq model selected.");
    return callGroq(apiKey, model, systemPrompt, userMessage, maxTokens);
  }
  // anthropic
  if (!apiKey) throw new Error("No Anthropic API key configured.");
  return callAnthropic(apiKey, model, systemPrompt, userMessage, maxTokens);
}
