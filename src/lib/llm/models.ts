/**
 * Backend model-list discovery, ported from llm_client.py
 * get_ollama_models / get_groq_models and generalized. Returns
 * { models, error }; models is empty and error is set on failure.
 *
 * Every OpenAI-compatible provider exposes GET /models with the same shape, so
 * one function serves OpenAI, Gemini, OpenRouter, and Groq.
 */
import { Ollama } from "ollama";
import { ollamaBaseUrl } from "./backends";

export interface ModelListResult {
  models: string[];
  error: string | null;
}

export async function getOllamaModels(): Promise<ModelListResult> {
  try {
    const client = new Ollama({ host: ollamaBaseUrl() });
    const data = await client.list();
    const names = (data.models ?? []).map((m) => m.name);
    return { models: names, error: null };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface OpenAICompatibleModelOptions {
  /** Non-chat model id substrings to exclude. */
  exclude?: string[];
  /** Strip this prefix from returned ids (Gemini: "models/"). */
  stripPrefix?: string;
}

export async function getOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  { exclude = [], stripPrefix }: OpenAICompatibleModelOptions = {}
): Promise<ModelListResult> {
  if (!apiKey) {
    return { models: [], error: "No API key provided." };
  }
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "ebook-flashcards/1.0",
      },
    });
    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        message = `HTTP ${resp.status}: ${body?.error?.message || ""}`.trim();
      } catch {
        /* ignore */
      }
      return { models: [], error: message };
    }
    const data = await resp.json();
    const names = (data.data ?? [])
      .map((m: { id: string }) =>
        stripPrefix && m.id.startsWith(stripPrefix) ? m.id.slice(stripPrefix.length) : m.id
      )
      .filter((id: string) => !exclude.some((x) => id.toLowerCase().includes(x)))
      .sort();
    return { models: names, error: null };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
