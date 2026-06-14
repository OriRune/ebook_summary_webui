"use client";

import { useState } from "react";
import type { Backend } from "@/types";
import {
  type Settings,
  keyForBackend,
  modelForBackend,
  keyFieldFor,
  modelFieldFor,
} from "@/hooks/useSettings";
import { PROVIDERS, ALL_BACKENDS } from "@/lib/llm/providers";

interface Props {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  allowOllama: boolean;
}

async function fetchModels(backend: Backend, apiKey: string) {
  const resp = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend, apiKey }),
  });
  return (await resp.json()) as { models: string[]; error: string | null };
}

export default function SettingsPanel({ settings, update, allowOllama }: Props) {
  // Each backend keeps its own fetched model list + refresh status.
  const [modelsByBackend, setModelsByBackend] = useState<Partial<Record<Backend, string[]>>>({});
  const [statusByBackend, setStatusByBackend] = useState<Partial<Record<Backend, string>>>({});

  const backend = settings.backend;
  const provider = PROVIDERS[backend];

  const setStatus = (b: Backend, s: string) =>
    setStatusByBackend((prev) => ({ ...prev, [b]: s }));
  const setModels = (b: Backend, m: string[]) =>
    setModelsByBackend((prev) => ({ ...prev, [b]: m }));

  async function refresh(b: Backend) {
    const keyField = keyFieldFor(b);
    const apiKey = keyForBackend(settings, b);
    if (keyField && !apiKey) {
      setStatus(b, "⚠ Enter API key first");
      return;
    }
    setStatus(b, "Checking…");
    const { models, error } = await fetchModels(b, apiKey);
    if (error || models.length === 0) {
      setStatus(b, `⚠ ${(error || "No models").slice(0, 80)}`);
      setModels(b, []);
      return;
    }
    setModels(b, models);
    const current = modelForBackend(settings, b);
    if (!current || !models.includes(current)) {
      // Prefer the top recommended model that the provider actually serves,
      // then the prefer-hint substring, then just the first model.
      const recommended = (PROVIDERS[b].recommended ?? []).map((r) => r.id);
      const recMatch = recommended.find((id) => models.includes(id));
      const hint = PROVIDERS[b].modelPreferHint;
      const hintMatch = hint ? models.find((m) => m.toLowerCase().includes(hint)) : undefined;
      update(modelFieldFor(b), recMatch || hintMatch || models[0]);
    }
    setStatus(b, `${models.length} model(s) found`);
  }

  const backendOptions = ALL_BACKENDS.filter((b) => b !== "ollama" || allowOllama);
  const fetchedModels = modelsByBackend[backend] ?? [];
  const status = statusByBackend[backend] ?? "";
  const currentModel = modelForBackend(settings, backend);
  const keyField = keyFieldFor(backend);

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex w-full items-center gap-1 sm:w-auto">
        <span className="text-muted">Backend:</span>
        <select
          className="field"
          value={backend}
          onChange={(e) => update("backend", e.target.value as Backend)}
        >
          {backendOptions.map((b) => (
            <option key={b} value={b}>
              {PROVIDERS[b].label}
              {b === "ollama" ? " (local)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* API key — every backend except Ollama. */}
      {keyField && (
        <label className="flex w-full items-center gap-1 sm:w-auto">
          <span className="text-muted">API key:</span>
          <input
            type="password"
            className="field w-full sm:w-64"
            placeholder={provider.keyPlaceholder}
            value={settings[keyField] as string}
            onChange={(e) => update(keyField, e.target.value)}
          />
        </label>
      )}

      {/* Model — free text for Anthropic, refreshable dropdown for the rest. */}
      {provider.kind === "anthropic" ? (
        <label className="flex w-full items-center gap-1 sm:w-auto">
          <span className="text-muted">Model:</span>
          <input
            className="field w-full sm:w-44"
            value={currentModel}
            onChange={(e) => update(modelFieldFor(backend), e.target.value)}
          />
        </label>
      ) : (
        <>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">Model:</span>
            <select
              className="field w-full sm:w-52"
              value={currentModel}
              onChange={(e) => update(modelFieldFor(backend), e.target.value)}
            >
              {currentModel && !fetchedModels.includes(currentModel) && (
                <option value={currentModel}>{currentModel}</option>
              )}
              {fetchedModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => refresh(backend)}>↺ Refresh</button>
          <span className="text-muted">{status}</span>
        </>
      )}

      {/* Suggested models — quick picks layered over the full provider list. */}
      {provider.recommended && provider.recommended.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Suggested:</span>
          {provider.recommended.map((r) => (
            <button
              key={r.id}
              type="button"
              title={r.note}
              aria-pressed={currentModel === r.id}
              onClick={() => update(modelFieldFor(backend), r.id)}
              className={`chip ${currentModel === r.id ? "chip-active" : ""}`}
            >
              {r.label ?? r.id}
            </button>
          ))}
        </div>
      )}

      <label className="flex w-full items-center gap-1 sm:w-auto">
        <span className="text-muted">Max chars/section:</span>
        <input
          type="number"
          min={2000}
          max={30000}
          step={1000}
          className="field w-24"
          value={settings.maxChars}
          onChange={(e) => update("maxChars", Number(e.target.value) || 9000)}
        />
      </label>

      {keyField && (
        <p className="w-full text-xs text-muted">
          🔒 Your {provider.label} key is stored only in this browser and sent with each request —
          never saved on our server.
          {provider.consoleUrl && (
            <>
              {" "}
              <a
                className="underline hover:text-[var(--accent)]"
                href={provider.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a key ↗
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
