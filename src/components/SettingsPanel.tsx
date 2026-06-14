"use client";

import { useState } from "react";
import type { Backend } from "@/types";
import type { Settings } from "@/hooks/useSettings";

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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [groqStatus, setGroqStatus] = useState("");

  async function refreshOllama() {
    setOllamaStatus("Checking…");
    const { models, error } = await fetchModels("ollama", "");
    if (error || models.length === 0) {
      setOllamaStatus(`⚠ ${error || "No models"}`);
      setOllamaModels([]);
    } else {
      setOllamaModels(models);
      if (!settings.ollamaModel || !models.includes(settings.ollamaModel)) {
        update("ollamaModel", models[0]);
      }
      setOllamaStatus(`${models.length} model(s) found`);
    }
  }

  async function refreshGroq() {
    if (!settings.groqKey) {
      setGroqStatus("⚠ Enter API key first");
      return;
    }
    setGroqStatus("Checking…");
    const { models, error } = await fetchModels("groq", settings.groqKey);
    if (error || models.length === 0) {
      setGroqStatus(`⚠ ${(error || "No models").slice(0, 80)}`);
      setGroqModels([]);
    } else {
      setGroqModels(models);
      if (!settings.groqModel || !models.includes(settings.groqModel)) {
        const preferred = models.find((m) => m.toLowerCase().includes("llama") && m.includes("70b"));
        update("groqModel", preferred || models[0]);
      }
      setGroqStatus(`${models.length} model(s) found`);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex w-full items-center gap-1 sm:w-auto">
        <span className="text-muted">Backend:</span>
        <select
          className="field"
          value={settings.backend}
          onChange={(e) => update("backend", e.target.value as Backend)}
        >
          <option value="anthropic">Anthropic API</option>
          <option value="groq">Groq</option>
          {allowOllama && <option value="ollama">Ollama (local)</option>}
        </select>
      </label>

      {settings.backend === "anthropic" && (
        <>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">API key:</span>
            <input
              type="password"
              className="field w-full sm:w-64"
              placeholder="sk-ant-…"
              value={settings.anthropicKey}
              onChange={(e) => update("anthropicKey", e.target.value)}
            />
          </label>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">Model:</span>
            <input
              className="field w-full sm:w-44"
              value={settings.anthropicModel}
              onChange={(e) => update("anthropicModel", e.target.value)}
            />
          </label>
        </>
      )}

      {settings.backend === "groq" && (
        <>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">API key:</span>
            <input
              type="password"
              className="field w-full sm:w-52"
              placeholder="gsk_…"
              value={settings.groqKey}
              onChange={(e) => update("groqKey", e.target.value)}
            />
          </label>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">Model:</span>
            <select
              className="field w-full sm:w-52"
              value={settings.groqModel}
              onChange={(e) => update("groqModel", e.target.value)}
            >
              {settings.groqModel && !groqModels.includes(settings.groqModel) && (
                <option value={settings.groqModel}>{settings.groqModel}</option>
              )}
              {groqModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={refreshGroq}>↺ Refresh</button>
          <span className="text-muted">{groqStatus}</span>
        </>
      )}

      {settings.backend === "ollama" && allowOllama && (
        <>
          <label className="flex w-full items-center gap-1 sm:w-auto">
            <span className="text-muted">Model:</span>
            <select
              className="field w-full sm:w-52"
              value={settings.ollamaModel}
              onChange={(e) => update("ollamaModel", e.target.value)}
            >
              {settings.ollamaModel && !ollamaModels.includes(settings.ollamaModel) && (
                <option value={settings.ollamaModel}>{settings.ollamaModel}</option>
              )}
              {ollamaModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={refreshOllama}>↺ Refresh</button>
          <span className="text-muted">{ollamaStatus}</span>
        </>
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

      {settings.backend !== "ollama" && (
        <p className="w-full text-xs text-muted">
          🔒 Your API key is stored only in this browser and sent with each request —
          never saved on our server.
        </p>
      )}
    </div>
  );
}
