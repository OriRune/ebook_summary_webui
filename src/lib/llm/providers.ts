/**
 * Provider registry — the single source of truth for every LLM backend the app
 * supports. Dependency-free and secret-free (no keys here): keys are always
 * user-supplied and sent per-request. Imported by the backend dispatch, the
 * model-list discovery, the /api/models route, the settings UI, and the cost
 * estimator so provider facts never drift apart.
 *
 * Most providers speak the OpenAI Chat Completions wire format (POST
 * /chat/completions, GET /models). Anthropic uses its own SDK; Ollama is local.
 */
import type { Backend } from "@/types";

export type ProviderKind = "anthropic" | "openai-compatible" | "ollama";

export interface ProviderInfo {
  id: Backend;
  /** Human-readable label (mirrors BACKEND_LABELS in types.ts). */
  label: string;
  kind: ProviderKind;
  /** Base URL for openai-compatible providers (no trailing slash). */
  baseUrl?: string;
  /** Non-chat model id substrings to hide from the model dropdown. */
  modelExclude?: string[];
  /**
   * Body field carrying the output-token cap. Defaults to "max_tokens";
   * OpenAI's newer models require "max_completion_tokens".
   */
  maxTokensField?: string;
  /** Some providers return prefixed ids (Gemini: "models/gemini-…"); strip it. */
  stripModelPrefix?: string;
  /** Placeholder shown in the API-key input. */
  keyPlaceholder?: string;
  /** "Get a key" link surfaced in the settings panel + how-to page. */
  consoleUrl?: string;
  /** After a model refresh, auto-select the first id containing this substring. */
  modelPreferHint?: string;
  /**
   * A short, hand-curated shortlist of good models, surfaced as clickable
   * "Suggested" chips in the settings panel. This is a starting point that may
   * drift over time — the live ↺ Refresh list is always authoritative. The
   * first entry doubles as the preferred auto-default after a refresh.
   */
  recommended?: RecommendedModel[];
  /**
   * Cost-estimate basis (USD per 1M tokens). "free" = local/no charge;
   * "varies" = gateway/many models, so we show guidance instead of a number.
   * Numbers are rough, editable ballparks — a guide, not a bill.
   */
  pricing: { input: number; output: number } | "varies" | "free";
}

export interface RecommendedModel {
  /** Exact model id sent to the provider. */
  id: string;
  /** Optional shorter display label for the chip (defaults to `id`). */
  label?: string;
  /** One-line trade-off blurb shown on hover (e.g. "cheap & fast"). */
  note?: string;
}

export const PROVIDERS: Record<Backend, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic API",
    kind: "anthropic",
    keyPlaceholder: "sk-ant-…",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    recommended: [
      { id: "claude-sonnet-4-6", note: "Balanced — recommended default" },
      { id: "claude-opus-4-8", note: "Most capable (pricier)" },
      { id: "claude-haiku-4-5", note: "Fast & cheap" },
    ],
    pricing: { input: 3.0, output: 15.0 }, // Claude Sonnet list pricing
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    // Newer OpenAI models reject `max_tokens` in favor of this field.
    maxTokensField: "max_completion_tokens",
    modelExclude: [
      "embedding",
      "whisper",
      "tts",
      "dall-e",
      "image",
      "audio",
      "moderation",
      "realtime",
      "search",
      "babbage",
      "davinci",
      "transcribe",
    ],
    keyPlaceholder: "sk-…",
    consoleUrl: "https://platform.openai.com/api-keys",
    modelPreferHint: "gpt-4o",
    recommended: [
      { id: "gpt-4o-mini", note: "Cheap & fast — great for bulk" },
      { id: "gpt-4o", note: "Best quality" },
      { id: "gpt-4.1-mini", note: "Balanced" },
    ],
    pricing: { input: 2.5, output: 10.0 }, // gpt-4o-class ballpark
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    stripModelPrefix: "models/",
    modelExclude: ["embedding", "aqa", "imagen", "tts", "learnlm"],
    keyPlaceholder: "AIza…",
    consoleUrl: "https://aistudio.google.com/apikey",
    modelPreferHint: "flash",
    recommended: [
      { id: "gemini-2.5-flash", note: "Cheap & fast" },
      { id: "gemini-2.5-pro", note: "Best quality" },
      { id: "gemini-2.0-flash", note: "Budget" },
    ],
    pricing: { input: 0.3, output: 2.5 }, // flash/pro ballpark
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-…",
    consoleUrl: "https://openrouter.ai/keys",
    modelPreferHint: "claude",
    // OpenRouter ids are namespaced "vendor/model". Value-oriented picks; the
    // catalog is huge and changes often, so Refresh is the real source of truth.
    recommended: [
      { id: "openai/gpt-4o-mini", label: "gpt-4o-mini", note: "Cheap & fast" },
      { id: "google/gemini-2.5-flash", label: "gemini-2.5-flash", note: "Great value" },
      { id: "deepseek/deepseek-chat", label: "deepseek-chat", note: "Very cheap" },
    ],
    pricing: "varies", // gateway: hundreds of models at different prices
  },
  groq: {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    // Groq hosts non-chat models too; exclude known non-chat id patterns.
    modelExclude: ["whisper", "distil-whisper", "tts", "playai", "vision"],
    keyPlaceholder: "gsk_…",
    consoleUrl: "https://console.groq.com/keys",
    modelPreferHint: "70b",
    recommended: [
      { id: "llama-3.3-70b-versatile", note: "Best quality" },
      { id: "llama-3.1-8b-instant", note: "Fast & cheap" },
    ],
    pricing: "varies",
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    kind: "ollama",
    pricing: "free",
  },
};

/** Backends that speak the OpenAI Chat Completions wire format. */
export function isOpenAICompatible(backend: Backend): boolean {
  return PROVIDERS[backend]?.kind === "openai-compatible";
}

/** All known backend ids (drives validation + the settings dropdown). */
export const ALL_BACKENDS = Object.keys(PROVIDERS) as Backend[];
