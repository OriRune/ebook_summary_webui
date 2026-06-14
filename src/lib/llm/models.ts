/**
 * Backend model-list discovery, ported from llm_client.py
 * get_ollama_models / get_groq_models. Returns { models, error }; models is
 * empty and error is set on failure.
 */
import { Ollama } from "ollama";
import { GROQ_BASE_URL, ollamaBaseUrl } from "./backends";

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

// Groq hosts non-chat models too; exclude known non-chat id patterns.
const GROQ_EXCLUDE = ["whisper", "distil-whisper", "tts", "playai", "vision"];

export async function getGroqModels(apiKey: string): Promise<ModelListResult> {
  if (!apiKey) {
    return { models: [], error: "No Groq API key provided." };
  }
  try {
    const resp = await fetch(`${GROQ_BASE_URL}/models`, {
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
      .map((m: { id: string }) => m.id)
      .filter((id: string) => !GROQ_EXCLUDE.some((x) => id.toLowerCase().includes(x)))
      .sort();
    return { models: names, error: null };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
