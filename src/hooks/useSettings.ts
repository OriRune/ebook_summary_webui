"use client";

/**
 * Settings persisted to localStorage (per the project's BYOK decision: API keys
 * live in the browser, sent per-request, never stored server-side). Dark mode is
 * applied to <html data-theme>. Ollama visibility is gated by the public env var.
 */
import { useCallback, useEffect, useState } from "react";
import type { Backend, ContentType } from "@/types";

export interface Settings {
  backend: Backend;
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  geminiKey: string;
  geminiModel: string;
  openrouterKey: string;
  openrouterModel: string;
  groqKey: string;
  groqModel: string;
  ollamaModel: string;
  maxChars: number;
  contentType: ContentType;
  includeSummary: boolean;
  includeFlashcards: boolean;
  includeDiscussion: boolean;
  includeCharacterList: boolean;
  includeContextDigest: boolean;
  darkMode: boolean;
}

const DEFAULTS: Settings = {
  backend: "anthropic",
  anthropicKey: "",
  anthropicModel: "claude-sonnet-4-6",
  openaiKey: "",
  openaiModel: "",
  geminiKey: "",
  geminiModel: "",
  openrouterKey: "",
  openrouterModel: "",
  groqKey: "",
  groqModel: "",
  ollamaModel: "",
  maxChars: 9000,
  contentType: "auto",
  includeSummary: true,
  includeFlashcards: true,
  includeDiscussion: false,
  includeCharacterList: false,
  includeContextDigest: false,
  darkMode: false,
};

const STORAGE_KEY = "ebook-settings";

export const ALLOW_OLLAMA = process.env.NEXT_PUBLIC_ALLOW_OLLAMA === "true";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Load once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
      }
    } catch {
      /* ignore corrupt storage */
    }
    setLoaded(true);
  }, []);

  // Persist on change (after initial load).
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }, [settings, loaded]);

  // Reflect dark mode on <html>.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
      "data-theme",
      settings.darkMode ? "dark" : "light"
    );
  }, [settings.darkMode]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  return { settings, update, loaded };
}

// --- per-backend field mapping (keeps the lookup in one place) ---------------

/** Settings field holding the API key for each backend (Ollama has none). */
const KEY_FIELD: Partial<Record<Backend, keyof Settings>> = {
  anthropic: "anthropicKey",
  openai: "openaiKey",
  gemini: "geminiKey",
  openrouter: "openrouterKey",
  groq: "groqKey",
};

/** Settings field holding the selected model for each backend. */
const MODEL_FIELD: Record<Backend, keyof Settings> = {
  anthropic: "anthropicModel",
  openai: "openaiModel",
  gemini: "geminiModel",
  openrouter: "openrouterModel",
  groq: "groqModel",
  ollama: "ollamaModel",
};

export function keyForBackend(settings: Settings, backend: Backend): string {
  const field = KEY_FIELD[backend];
  return field ? (settings[field] as string) : "";
}

export function modelForBackend(settings: Settings, backend: Backend): string {
  return settings[MODEL_FIELD[backend]] as string;
}

export function modelFieldFor(backend: Backend): keyof Settings {
  return MODEL_FIELD[backend];
}

export function keyFieldFor(backend: Backend): keyof Settings | null {
  return KEY_FIELD[backend] ?? null;
}
