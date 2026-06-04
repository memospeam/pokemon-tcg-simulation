import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleComplete } from "./client";
import { createCompleteFromEnv } from "./clientAnthropic";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_BASE_URL;
});

describe("createOpenAICompatibleComplete", () => {
  it("POSTs to <baseUrl>/chat/completions and returns choices[0].message.content", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "3 - end turn" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const complete = createOpenAICompatibleComplete({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
    });
    const out = await complete("SYS", "USER");

    expect(out).toBe("3 - end turn");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("llama3.1");
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "USER" });
    // No API key → no Authorization header (Ollama needs none).
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("sends a bearer token when apiKey is provided", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "1" } }] }), { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const complete = createOpenAICompatibleComplete({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      apiKey: "gsk_test",
    });
    await complete("S", "U");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test");
  });
});

describe("createCompleteFromEnv", () => {
  it("LLM_PROVIDER=ollama builds a local client with no key required", () => {
    process.env.LLM_PROVIDER = "ollama";
    // Should not throw even though ANTHROPIC_API_KEY is unset.
    expect(() => createCompleteFromEnv()).not.toThrow();
  });

  it("openai-compatible without LLM_BASE_URL throws a clear error", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    expect(() => createCompleteFromEnv()).toThrow(/LLM_BASE_URL/);
  });
});
