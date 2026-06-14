import { describe, it, expect, vi, afterEach } from "vitest";
import { callModel } from "@/lib/llm/backends";

interface MockResp {
  ok: boolean;
  status: number;
  headers: { get: (h: string) => string | null };
  json: () => Promise<unknown>;
}

function errResp(status: number, retryAfter?: string): MockResp {
  return {
    ok: false,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter ?? null : null),
    },
    json: async () => ({}),
  };
}

function okResp(content: string): MockResp {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

const callGroq = () =>
  callModel({
    backend: "groq",
    apiKey: "key",
    model: "llama-3.1-8b-instant",
    systemPrompt: "sys",
    userMessage: "msg",
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Groq rate-limit handling (§10)", () => {
  it("10.1 retries on 429 with Retry-After ≤ 120s, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errResp(429, "30") as unknown as Response)
      .mockResolvedValueOnce(okResp("recovered") as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const p = callGroq();
    await vi.advanceTimersByTimeAsync(30_000); // honor the 30s Retry-After sleep
    await expect(p).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("10.2 raises immediately when Retry-After > 120s", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResp(429, "845") as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGroq()).rejects.toThrow(/quota exceeded/i);
    await expect(callGroq()).rejects.toThrow(/Groq rate limit/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one fetch per call, no retry
  });

  it("10.3 HTTP 413 → clear too-large error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResp(413) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGroq()).rejects.toThrow(/too large/i);
  });
});
