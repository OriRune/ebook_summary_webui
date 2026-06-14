import { describe, it, expect, vi, afterEach } from "vitest";
import { callModel } from "@/lib/llm/backends";
import { getOpenAICompatibleModels } from "@/lib/llm/models";
import { PROVIDERS, ALL_BACKENDS } from "@/lib/llm/providers";

function okResp(content: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAI-compatible dispatch", () => {
  it("routes each provider to its own base URL", async () => {
    const cases: Array<[Parameters<typeof callModel>[0]["backend"], string]> = [
      ["openai", "https://api.openai.com/v1/chat/completions"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
      ["openrouter", "https://openrouter.ai/api/v1/chat/completions"],
      ["groq", "https://api.groq.com/openai/v1/chat/completions"],
    ];
    for (const [backend, url] of cases) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResp("ok"));
      vi.stubGlobal("fetch", fetchMock);
      await callModel({ backend, apiKey: "k", model: "m", systemPrompt: "s", userMessage: "u" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(url);
      vi.restoreAllMocks();
    }
  });

  it("OpenAI uses max_completion_tokens; others use max_tokens", async () => {
    const openaiFetch = vi.fn<typeof fetch>().mockResolvedValue(okResp("ok"));
    vi.stubGlobal("fetch", openaiFetch);
    await callModel({ backend: "openai", apiKey: "k", model: "gpt-4o", systemPrompt: "s", userMessage: "u" });
    const openaiBody = JSON.parse((openaiFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(openaiBody.max_completion_tokens).toBeGreaterThan(0);
    expect(openaiBody.max_tokens).toBeUndefined();
    vi.restoreAllMocks();

    const groqFetch = vi.fn<typeof fetch>().mockResolvedValue(okResp("ok"));
    vi.stubGlobal("fetch", groqFetch);
    await callModel({ backend: "groq", apiKey: "k", model: "llama", systemPrompt: "s", userMessage: "u" });
    const groqBody = JSON.parse((groqFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(groqBody.max_tokens).toBeGreaterThan(0);
    expect(groqBody.max_completion_tokens).toBeUndefined();
  });
});

describe("getOpenAICompatibleModels", () => {
  it("strips the Gemini id prefix and drops excluded models", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "models/gemini-2.5-flash" },
          { id: "models/embedding-001" },
          { id: "models/gemini-1.5-pro" },
        ],
      }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { models, error } = await getOpenAICompatibleModels(
      PROVIDERS.gemini.baseUrl!,
      "key",
      { exclude: PROVIDERS.gemini.modelExclude, stripPrefix: PROVIDERS.gemini.stripModelPrefix }
    );

    expect(error).toBeNull();
    expect(models).toEqual(["gemini-1.5-pro", "gemini-2.5-flash"]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${PROVIDERS.gemini.baseUrl}/models`);
  });

  it("errors without an API key", async () => {
    const { models, error } = await getOpenAICompatibleModels("https://x/v1", "");
    expect(models).toEqual([]);
    expect(error).toMatch(/api key/i);
  });
});

describe("recommended models registry", () => {
  it("every cloud provider has a non-empty list of valid recommendations", () => {
    for (const backend of ALL_BACKENDS) {
      if (backend === "ollama") continue; // local models depend on the user's install
      const { recommended } = PROVIDERS[backend];
      expect(recommended, `${backend} should have recommendations`).toBeDefined();
      expect(recommended!.length).toBeGreaterThan(0);
      for (const r of recommended!) {
        expect(typeof r.id).toBe("string");
        expect(r.id.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
